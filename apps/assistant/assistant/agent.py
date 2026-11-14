"""Agent hỏi đáp có trích dẫn: ask(question) -> Answer.

Luồng: nén lịch sử -> truy xuất sơ bộ -> DeepSeek gọi tool (search_documents / search_investigations /
predict_flammability) -> trả lời kèm nhãn [S#]/[I#]/[P#] -> hậu kiểm trích dẫn (guardrail).
Mọi bước được ghi vào trace (assistant/trace.py).
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
from dataclasses import replace
from typing import Any, Callable

from . import config, integrations, kg, ranking
from .context import SUMMARY_SYSTEM, prepare_history, transcript
from .prompts import REFUSAL_MARKER, SYSTEM_PROMPT, active_tools
from .retriever import DocumentRetriever, expand_query
from .schema import Answer, Citation
from .trace import Trace
from .verify import verify_answer

OFFLINE_TOP_K = 3
_STUDY_WORDS = ("nghiên cứu", "thí nghiệm", "investigation", "study", "studies", "experiment")
_GRAPH_WORDS = re.compile(r"apollo[ -]?13|apollo[ -]?1\b|\bmir\b|oxygen candle|lithium perchlorate", re.I)
_RANK_WORDS = re.compile(r"\b(rank|ranking|most relevant|prioriti[sz]e|top \d+|which investigations? (?:are|is|matter|should))|xếp hạng|phù hợp nhất|quan trọng nhất", re.I)
_COMPARE_WORDS = re.compile(r"\b(compare|comparison|versus|vs\.?|differ|difference|similarit)|so sánh", re.I)

_TAG_GROUP = re.compile(r"\[((?:[SIPR]\d+)(?:\s*[,;]\s*[SIPR]\d+)*)\]")


def _refusal_text(question: str) -> str:
    """Output luôn bằng tiếng Anh (sản phẩm phục vụ NASA), kể cả khi câu hỏi bằng tiếng Việt."""
    return ("I could not find evidence in the loaded NASA data to answer this. Try a more specific question "
            "(experiment name, material, O₂ level...) or add the relevant source documents.")


class EvidenceRegistry:
    """Gán nhãn trích dẫn cho mọi bằng chứng tool trả về; chỉ các nhãn ở đây mới hợp lệ.

    Đồng thời quản lý ngân sách bằng chứng của 1 request: đoạn đã gửi cho LLM thì lần sau chỉ gửi nhãn,
    và khi tổng số ký tự vượt EVIDENCE_CHAR_BUDGET thì chỉ gửi đoạn trích ngắn.
    """

    def __init__(self) -> None:
        self.items: dict[str, Citation] = {}
        self._keys: dict[tuple, str] = {}
        self._counters = {"S": 0, "I": 0, "P": 0, "R": 0}
        self.texts: dict[str, str] = {}  # nhãn -> toàn văn bằng chứng (để kiểm tra trích dẫn)
        self.tables: list[str] = []      # bảng so sánh do tool tạo (để khôi phục nếu LLM sửa)
        self.sent_chunks: set[str] = set()
        self.sent_chars = 0
        self.searches = 0                # số lần search_documents do model gọi (trần MAX_SEARCHES)
        self.deduped = 0
        self.truncated = 0

    def add(self, prefix: str, kind: str, key: tuple, **fields: Any) -> str:
        if key in self._keys:
            return self._keys[key]
        self._counters[prefix] += 1
        ref = f"{prefix}{self._counters[prefix]}"
        self.items[ref] = Citation(ref=ref, kind=kind, **fields)
        self._keys[key] = ref
        return ref

    def take_text(self, chunk_id: str, text: str) -> tuple[str | None, str]:
        """Trả về (text gửi cho LLM, trạng thái): 'full' | 'already_provided' | 'truncated'."""
        if chunk_id in self.sent_chunks:
            self.deduped += 1
            return None, "already_provided"
        self.sent_chunks.add(chunk_id)
        if self.sent_chars + len(text) > config.EVIDENCE_CHAR_BUDGET:
            snippet = text[:config.OVER_BUDGET_SNIPPET_CHARS] + " …"
            self.sent_chars += len(snippet)
            self.truncated += 1
            return snippet, "truncated"
        self.sent_chars += len(text)
        return text, "full"

    def __contains__(self, ref: str) -> bool:
        return ref in self.items


class Assistant:
    def __init__(self, llm: Any = None, retriever: DocumentRetriever | None = None, offline: bool | None = None):
        self._llm = llm
        self.retriever = retriever or DocumentRetriever()
        if offline is None:
            mode = config.OFFLINE_MODE
            offline = mode == "1" or (mode == "auto" and llm is None and not config.DEEPSEEK_API_KEY)
        self.offline = offline
        self._tls = threading.local()  # callback streaming riêng cho từng request (server đa luồng)

    def _emit(self, event: dict) -> None:
        cb = getattr(self._tls, "emit", None)
        if cb:
            try:
                cb(event)
            except Exception:  # client ngắt kết nối không được làm hỏng câu trả lời
                self._tls.emit = None

    @property
    def llm(self):
        if self._llm is None:
            from .llm import DeepSeekClient
            self._llm = DeepSeekClient()
        return self._llm

    # ---------- LLM call (có trace) ----------
    def _chat(self, messages: list[dict], tools: list | None, ans: Answer, trace: Trace,
              purpose: str, round_: int = 0):
        t0 = time.perf_counter()
        streaming = purpose == "answer" and getattr(self._tls, "emit", None) is not None \
            and hasattr(self.llm, "chat_stream")
        if streaming:
            msg, cost = self.llm.chat_stream(messages, tools=tools,
                                             on_text=lambda t: self._emit({"type": "delta", "text": t}))
        else:
            msg, cost = self.llm.chat(messages, tools=tools)
        usage = getattr(self.llm, "last_usage", None) or {}
        ans.cost_usd += cost
        ans.prompt_tokens += usage.get("prompt_tokens", 0)
        ans.completion_tokens += usage.get("completion_tokens", 0)
        trace.event("llm_call", purpose=purpose, round=round_, latency_ms=int((time.perf_counter() - t0) * 1000),
                    prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"),
                    cache_hit_tokens=usage.get("cache_hit_tokens"), cost_usd=round(cost, 6),
                    context_chars=sum(len(str(m.get("content") or "")) for m in messages),
                    tools_chars=len(json.dumps(tools, ensure_ascii=False)) if tools else 0,
                    n_messages=len(messages), n_tool_calls=len(getattr(msg, "tool_calls", None) or []))
        return msg

    # ---------- tools ----------
    def _tool_search_documents(self, reg: EvidenceRegistry, trace: Trace | None, origin: str,
                               query: str, source_id: str | None = None, k: int = 5) -> dict:
        k = max(1, min(int(k or 5), 8))
        hits = self.retriever.search(query, k=k, source_id=source_id)
        detail = {d["chunk"]: d for d in getattr(self.retriever, "last_details", [])}
        results = []
        for chunk, score in hits:
            ref = reg.add("S", "document", ("S", chunk.id), source_id=chunk.source_id, title=chunk.title,
                          url=chunk.url, snippet=chunk.text[:300], is_mock=chunk.is_mock,
                          page=chunk.page, page_url=chunk.page_url)
            reg.texts.setdefault(ref, f"{chunk.title}\n{chunk.section}\n{chunk.text}")
            text, status = reg.take_text(chunk.id, chunk.text)
            item = {"tag": f"[{ref}]", "source_id": chunk.source_id, "title": chunk.title,
                    "section": chunk.section, "score": round(score, 2), "is_mock": chunk.is_mock}
            if chunk.page:
                item["page"] = chunk.page
            if status == "already_provided":
                item["note"] = "already provided earlier in this conversation turn; cite the same tag"
            else:
                item["text"] = text
                if status == "truncated":
                    item["note"] = "truncated (context budget); search with source_id for more detail"
            item["_full_text"] = chunk.text  # chỉ dùng nội bộ (offline), bị xóa trước khi gửi LLM
            results.append(item)
        if trace:
            trace.event("retrieval", origin=origin, query=query, source_id=source_id, k=k,
                        retriever=getattr(self.retriever, "mode", "bm25"),
                        hits=[{"tag": r["tag"], "chunk": c.id, "score": round(s, 3),
                               **{x: detail.get(c.id, {}).get(x) for x in ("bm25", "dense") if detail.get(c.id, {}).get(x) is not None}}
                              for r, (c, s) in zip(results, hits)],
                        evidence_chars_sent=reg.sent_chars)
        return {"query": query, "n_results": len(results), "results": results}

    def _tool_search_investigations(self, reg: EvidenceRegistry, **kwargs: Any) -> dict:
        rows = integrations.search_investigations(**kwargs)
        out = []
        for r in rows:
            ref = reg.add("I", "investigation", ("I", r.get("psi_id")), source_id=str(r.get("psi_id", "")),
                          title=str(r.get("name", "")), url=str(r.get("link", "")),
                          snippet=str(r.get("description", ""))[:300], is_mock=bool(r.get("is_mock")))
            reg.texts.setdefault(ref, "\n".join(f"{k}: {v}" for k, v in r.items() if v not in (None, "")))
            out.append({"tag": f"[{ref}]", **r})
        return {"filters": kwargs, "n_results": len(out), "results": out}

    def _tool_predict(self, reg: EvidenceRegistry, **kwargs: Any) -> dict:
        res = integrations.predict(**kwargs)
        ref = reg.add("P", "prediction", ("P", json.dumps(kwargs, sort_keys=True)),
                      source_id=str(res.get("model", "module5")), title="Module 5 prediction",
                      snippet=json.dumps(res.get("inputs", kwargs))[:300], is_mock=bool(res.get("is_mock")))
        reg.texts[ref] = json.dumps(res, default=str)
        return {"tag": f"[{ref}]", **res}

    def _tool_compare(self, reg: EvidenceRegistry, investigations: list[str] | str) -> dict:
        """Bảng so sánh dựng sẵn từ metadata (không do LLM viết) -> số liệu trong bảng luôn đúng nguồn."""
        names = [investigations] if isinstance(investigations, str) else list(investigations or [])
        recs, unresolved = integrations.resolve_investigations(names)
        if len(recs) < 2:
            return {"error": "need at least 2 resolvable investigations", "resolved": [r["psi_id"] for r in recs],
                    "unresolved": unresolved}
        tags = []
        for r in recs:
            tags.append(reg.add("I", "investigation", ("I", r["psi_id"]), source_id=r["psi_id"],
                                title=r.get("title", ""), url=r.get("link", ""), page_url=r.get("link", ""),
                                snippet=r.get("objective", "")[:300], is_mock=bool(r.get("is_mock"))))
            reg.texts[tags[-1]] = "\n".join(f"{k}: {v}" for k, v in r.items() if v not in (None, ""))
        cell = lambda v: str(v or "—").replace("|", "/").replace("\n", " ")[:70]  # noqa: E731
        head = "| Attribute | " + " | ".join(f"{r['psi_id']} {r.get('acronym') or ''} [{t}]".replace("  ", " ")
                                             for r, t in zip(recs, tags)) + " |"
        lines = [head, "|" + "---|" * (len(recs) + 1)]
        same, diff = [], []
        for label, key in integrations.COMPARE_ATTRIBUTES:
            vals = [str(r.get(key) or "") for r in recs]
            if not any(vals) or key == "acronym":
                continue
            lines.append(f"| {label} | " + " | ".join(cell(v) for v in vals) + " |")
            (same if len(set(vals)) == 1 else diff).append(label)
        reg.tables.append("\n".join(lines))
        return {
            "table_markdown": "\n".join(lines),
            "same_attributes": same, "different_attributes": diff, "unresolved": unresolved,
            "investigations": [{"tag": f"[{t}]", "psi_id": r["psi_id"], "acronym": r.get("acronym"),
                                "objective": r.get("objective")} for r, t in zip(recs, tags)],
            "note": "Metadata only. For sample sizes, conditions and results, call search_documents with source_id.",
        }

    def _chunk_by_id(self, cid: str):
        if not hasattr(self, "_chunk_index"):
            self._chunk_index = {c.id: c for c in self.retriever.chunks}
        return self._chunk_index.get(cid)

    def _tool_explore_graph(self, reg: EvidenceRegistry, entity: str, relation: str | None = None,
                            limit: int = 12) -> dict:
        """Tra knowledge graph: liên kết của một nghiên cứu / vật liệu / thiết bị / sự cố / khái niệm, kèm bằng chứng.
        Mỗi liên kết được gắn nhãn: [S#] nếu bằng chứng là một đoạn trong corpus, [I#] nếu từ hồ sơ PSI."""
        g = kg.get_graph()
        if not g.available:
            return {"error": "knowledge graph not available"}
        ids = g.resolve(entity)
        if not ids:
            return {"error": f"no graph node matches {entity!r}",
                    "hint": "try a PSI id or acronym (FLEX, BASS), a material (Nomex, PMMA), hardware (CIR, MSG), "
                            "an incident (Apollo 1, Apollo 13, Mir 1997) or a concept (smoke, oxygen concentration)"}
        nid = ids[0]
        node = g.nodes[nid]
        if node.get("type") == "program" and not relation:
            relation = "includes"
        limit = max(1, min(int(limit or 12), 25))
        records = {r["psi_id"]: r for r in integrations.psi_records()}

        def inv_tag(psi: str, extra: str) -> str | None:
            r = records.get(psi)
            if not r:
                return None
            t = reg.add("I", "investigation", ("I", psi), source_id=psi, title=r.get("title", ""),
                        url=r.get("link", ""), page_url=r.get("link", ""), snippet=str(r.get("objective", ""))[:300],
                        is_mock=bool(r.get("is_mock")))
            base = reg.texts.get(t) or "\n".join(f"{k}: {v}" for k, v in r.items() if v not in (None, ""))
            reg.texts[t] = base if extra in base else f"{base}\n{extra}"
            return t

        links = []
        for x in g.neighbors(nid, relation, limit):
            tag = None
            c = self._chunk_by_id(x["chunk"]) if x.get("chunk") else None
            if c is not None:
                tag = reg.add("S", "document", ("S", c.id), source_id=c.source_id, title=c.title, url=c.url,
                              snippet=c.text[:300], is_mock=c.is_mock, page=c.page, page_url=c.page_url)
                reg.texts.setdefault(tag, f"{c.title}\n{c.section}\n{c.text}")
            else:
                psi = nid if node.get("type") == "investigation" else x["node"] if x["type"] == "investigation" else None
                if psi:
                    tag = inv_tag(psi, f"{x['relation']} {x['label']}: {x['evidence']}")
            links.append({"relation": x["relation"], "direction": x["direction"], "node": x["label"],
                          "node_type": x["type"], "evidence": x["evidence"][:300],
                          "tag": f"[{tag}]" if tag else None})
        return {
            "entity": node.get("label", nid), "id": nid, "type": node.get("type"),
            "other_matches": [g.nodes[i].get("label", i) for i in ids[1:4]],
            "relation_counts": g.relation_counts(nid), "links": links,
            "note": ("A graph link means a NASA source sentence mentions both ends (quoted in 'evidence'); it is not "
                     "proof of cause. Cite each link's tag; links with tag null have no citable passage: omit them."),
        }

    def _psi_doc_texts(self) -> dict[str, str]:
        if not hasattr(self, "_doc_texts_cache"):
            texts: dict[str, list[str]] = {}
            for c in self.retriever.chunks:
                if c.source_id.startswith("PSI-") and c.section != "Publications":
                    texts.setdefault(c.source_id, []).append(c.text)
            self._doc_texts_cache = {k: "\n".join(v) for k, v in texts.items()}
        return self._doc_texts_cache

    def _tool_rank(self, reg: EvidenceRegistry, scenario: str, need: str | None = None, top_k: int = 5) -> dict:
        """Xếp hạng nghiên cứu theo kịch bản (Module 4 rank() nếu có, không thì công thức minh bạch tạm)."""
        key = ranking.resolve_scenario(scenario)
        if not key:
            return {"error": f"unknown scenario {scenario!r}; use one of {list(ranking.SCENARIOS)}"}
        need = need if need in ranking.NEEDS else None
        sc = ranking.SCENARIOS[key]
        records = integrations.psi_records()
        res = ranking.rank(records, self._psi_doc_texts(), key, need, top_k)
        rtag = reg.add("R", "scenario", ("R", key), source_id="SPACEAPPS-2026-CH8",
                       title=f"Scenario conditions – {sc['label']} (NASA Space Apps 2026 challenge statement)",
                       url=ranking.CHALLENGE_URL, page_url=ranking.CHALLENGE_URL, snippet=sc["conditions"][:300])
        reg.texts[rtag] = sc["conditions"]
        by_id = {r["psi_id"]: r for r in records}
        lines = ["| Rank | Investigation | Relevance (0-100) | Publications in PSI | Why it ranks here |",
                 "|---|---|---|---|---|"]
        out = []
        for i, row in enumerate(res["rows"], 1):
            meta = by_id.get(row["psi_id"], {"psi_id": row["psi_id"]})
            tag = reg.add("I", "investigation", ("I", row["psi_id"]), source_id=row["psi_id"],
                          title=meta.get("title", row.get("title", "")), url=meta.get("link", ""),
                          page_url=meta.get("link", ""), snippet=str(meta.get("objective", ""))[:300],
                          is_mock=bool(meta.get("is_mock")))
            reg.texts.setdefault(tag, "\n".join(f"{k}: {v}" for k, v in meta.items() if v not in (None, "")))
            why = "; ".join(row.get("reasons", []))[:170].replace("|", "/")
            name = f"{row['psi_id']} {row.get('acronym') or ''}".strip()
            depth = row.get("evidence_depth", "—")
            lines.append(f"| {i} | {name} [{tag}] | {row['score']} | {depth} | {why} |")
            out.append({"rank": i, "tag": f"[{tag}]", **{k: v for k, v in row.items() if k != "title"}})
        table = "\n".join(lines)
        reg.tables.append(table)
        return {
            "scenario": sc["label"], "scenario_conditions_tag": f"[{rtag}]", "scenario_conditions": sc["conditions"],
            "gravity_note": sc["gravity_note"], "need": need, "provider": res["provider"],
            "is_placeholder": res["is_placeholder"], "weights": res.get("weights"),
            "table_markdown": table, "ranked": out,
            "note": ("Relevance = weighted, graded keyword evidence in PSI metadata/pages (fire-safety focus, "
                     "scenario conditions, cabin-type materials, prevention/detection/suppression). It ranks "
                     "relevance, not measured fire risk. 'Publications in PSI' shows evidence depth separately."
                     if res["is_placeholder"] else "Ranking from Module 4."),
        }

    def _run_tool(self, name: str, raw_args: str, reg: EvidenceRegistry, trace: Trace) -> dict:
        try:
            args = json.loads(raw_args or "{}")
            if name == "search_documents":
                if reg.searches >= config.MAX_SEARCHES:
                    trace.event("search_limit", limit=config.MAX_SEARCHES)
                    return {"error": f"search limit reached ({config.MAX_SEARCHES} per question). Answer now with "
                                     "the evidence already retrieved; state briefly what is missing."}
                reg.searches += 1
                return self._tool_search_documents(reg, trace, "tool", **args)
            if name == "rank_investigations":
                return self._tool_rank(reg, **args)
            if name == "explore_graph":
                return self._tool_explore_graph(reg, **args)
            if name == "search_investigations":
                return self._tool_search_investigations(reg, **args)
            if name == "predict_flammability":
                return self._tool_predict(reg, **args)
            if name == "compare_investigations":
                return self._tool_compare(reg, **args)
            return {"error": f"unknown tool {name}"}
        except Exception as e:  # trả lỗi cho model tự xử lý thay vì crash
            return {"error": f"{type(e).__name__}: {e}"}

    @staticmethod
    def _for_llm(result: dict) -> str:
        """Bỏ trường nội bộ trước khi gửi kết quả tool cho LLM."""
        if "results" in result:
            result = {**result, "results": [{k: v for k, v in r.items() if not k.startswith("_")}
                                            for r in result["results"]]}
        return json.dumps(result, ensure_ascii=False, default=str)

    # ---------- main ----------
    def ask(self, question: str, history: list[dict] | None = None,
            on_event: Callable[[dict], None] | None = None) -> Answer:
        """on_event (tuỳ chọn) nhận sự kiện để hiển thị dần (streaming):
          {"type": "status", "text": "..."}   đang làm gì (search, so sánh, xếp hạng...)
          {"type": "delta", "text": "..."}    đoạn chữ model vừa sinh ra
          {"type": "reset"}                   bỏ chữ đã stream (model chuyển sang gọi tool)
        Câu trả lời cuối (đã hậu kiểm, sửa tag, khôi phục bảng) vẫn là giá trị trả về."""
        self._tls.emit = on_event
        trace = Trace(question, mode="offline" if self.offline else "llm", history_len=len(history or []))
        try:
            if self.offline:
                self._emit({"type": "status", "text": "Searching documents (offline)…"})
                ans = self._ask_offline(question, trace)
            else:
                try:
                    ans = self._ask_llm(question, history, trace)
                except Exception as e:
                    if not config.FALLBACK_OFFLINE:
                        raise
                    trace.event("fallback", error=f"{type(e).__name__}: {e}")
                    self._emit({"type": "reset"})
                    self._emit({"type": "status", "text": "DeepSeek failed – falling back to offline mode…"})
                    ans = self._ask_offline(question, trace)
                    ans.warnings.insert(0, f"DeepSeek call failed ({type(e).__name__}: {e}); fell back to offline mode.")
        except Exception as e:
            trace.finish(error=f"{type(e).__name__}: {e}")
            raise
        ans.trace_id = trace.id
        ans.latency_ms = trace.elapsed_ms()
        trace.finish(ans)
        self._tls.emit = None
        return ans

    def _ask_offline(self, question: str, trace: Trace) -> Answer:
        """Không dùng LLM: trích nguyên văn các đoạn khớp nhất, vẫn kèm nhãn trích dẫn."""
        reg = EvidenceRegistry()
        ans = Answer(question=question, answer="")
        query = expand_query(question)
        docs = self._tool_search_documents(reg, trace, "offline", query=query, k=OFFLINE_TOP_K)
        ans.tool_calls.append({"name": "search_documents(offline)", "args": {"query": query},
                               "n_results": docs["n_results"]})
        rows: list[dict] = []
        if any(w in question.lower() for w in _STUDY_WORDS):
            inv = self._tool_search_investigations(reg, query=query, limit=3)
            ans.tool_calls.append({"name": "search_investigations(offline)", "args": {"query": query},
                                   "n_results": inv["n_results"]})
            trace.event("tool_call", name="search_investigations(offline)", n_results=inv["n_results"])
            rows = inv["results"]

        table = None
        scen = ranking.resolve_scenario(question) if _RANK_WORDS.search(question) else None
        if scen:
            rk = self._tool_rank(reg, scen)
            trace.event("tool_call", name="rank_investigations(offline)", args=json.dumps({"scenario": scen}),
                        n_results=len(rk.get("ranked", [])), error=rk.get("error"))
            table = (f"Ranking for {rk['scenario']} ({'placeholder formula' if rk['is_placeholder'] else rk['provider']}). "
                     f"Scenario conditions {rk['scenario_conditions_tag']}. {rk['gravity_note']}\n\n{rk['table_markdown']}")
        elif _GRAPH_WORDS.search(question):
            gx = self._tool_explore_graph(reg, _GRAPH_WORDS.search(question).group(0))
            trace.event("tool_call", name="explore_graph(offline)", args=json.dumps({"entity": gx.get("entity")}),
                        n_results=len(gx.get("links", [])), error=gx.get("error"))
            if gx.get("links"):
                table = "\n".join([f"Knowledge graph links for {gx['entity']} (each quoted from a NASA source):"] +
                                  [f"- {l['relation']} → {l['node']}: {l['evidence']} {l['tag'] or ''}".rstrip()
                                   for l in gx["links"] if l["tag"]])
        elif _COMPARE_WORDS.search(question):
            names = integrations.detect_investigation_names(question)
            if len(names) >= 2 or (names and integrations.resolve_investigations(names)[0][1:]):
                cmp = self._tool_compare(reg, names)
                trace.event("tool_call", name="compare_investigations(offline)", args=json.dumps(names),
                            n_results=len(cmp.get("investigations", [])), error=cmp.get("error"))
                table = cmp.get("table_markdown")
        if not docs["results"] and not rows and not table:
            text = REFUSAL_MARKER
        else:
            lines = []
            if table:
                lines += [table if scen or table.startswith("Knowledge graph") else
                          "Comparison (from NASA PSI metadata):\n" + table, ""]
            lines += ["Most relevant passages found (offline mode, not synthesized by AI):"]
            for r in docs["results"]:
                full = r["_full_text"]
                snippet = full if len(full) <= 400 else full[:400].rsplit(" ", 1)[0] + "…"
                head = f"{r['title']}" + (f" – {r['section']}" if r.get("section") else "")
                lines.append(f"- **{head}**: {snippet} {r['tag']}")
            if rows:
                lines.append("\nPossibly related investigations:")
                for r in rows:
                    lines.append(f"- {r.get('psi_id')} – {r.get('name')}: {r.get('description', '')} {r['tag']}")
            text = "\n".join(lines)

        self._finalize(ans, text, reg, trace)
        ans.warnings.insert(0, "Offline mode: no LLM used; showing the best-matching source passages (BM25).")
        return ans

    def _build_messages(self, question: str, recent: list[dict], summary: str, prefetch: dict) -> list[dict]:
        """Dựng messages cho lượt gọi đầu. Dùng chung cho ask() và preview_context() để preview luôn khớp."""
        user_content = question
        if prefetch["n_results"]:
            user_content += ("\n\n<prefetched_passages note=\"auto-retrieved with the raw question; often incomplete - if they do not directly answer, call search_documents with better English keywords\">\n"
                             + self._for_llm(prefetch) + "\n</prefetched_passages>")
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if summary:
            messages.append({"role": "system", "content":
                             f"Summary of the earlier conversation (context only, NOT evidence, do not cite): {summary}"})
        messages += recent
        messages.append({"role": "user", "content": user_content})
        return messages

    # ---------- xem trước context + ước lượng chi phí (không gọi LLM) ----------
    def preview_context(self, question: str, history: list[dict] | None = None) -> dict:
        from . import cost
        from .llm import UsageTracker

        reg = EvidenceRegistry()
        recent, summary, stats = prepare_history(history, None, dry_run=True)
        older = stats.pop("older_messages", [])
        prefetch = self._tool_search_documents(reg, None, "preview", query=question, k=config.TOP_K)
        messages = self._build_messages(question, recent, summary, prefetch)

        cpt = cost.calibrate()
        tok = lambda s: cost.estimate_tokens(s, cpt)  # noqa: E731
        evidence_json = self._for_llm(prefetch) if prefetch["n_results"] else ""
        user_msg = messages[-1]["content"]
        parts = [
            {"part": "system_prompt", "chars": len(SYSTEM_PROMPT), "tokens": tok(SYSTEM_PROMPT)},
            {"part": "tool_schema", "chars": len(json.dumps(active_tools(), ensure_ascii=False)),
             "tokens": cost.tools_tokens(active_tools(), cpt)},
            {"part": "history_summary", "chars": len(summary), "tokens": tok(summary)},
            {"part": f"history_recent ({len(recent)} msgs)", "chars": sum(len(m["content"]) for m in recent),
             "tokens": cost.messages_tokens(recent, cpt)},
            {"part": "question", "chars": len(question), "tokens": tok(question)},
            {"part": f"prefetched_evidence ({prefetch['n_results']} chunks)",
             "chars": len(user_msg) - len(question), "tokens": tok(user_msg[len(question):])},
        ]
        base_in = cost.messages_tokens(messages, cpt) + cost.tools_tokens(active_tools(), cpt)

        # 1 kết quả search_documents điển hình ~ bằng prefetch; nếu prefetch rỗng thì lấy độ dài chunk trung bình
        if evidence_json:
            search_tokens = tok(evidence_json)
        else:
            avg = sum(len(c.text) for c in self.retriever.chunks) / max(len(self.retriever.chunks), 1)
            search_tokens = math.ceil(avg * config.TOP_K / 4)
        summary_in = 0
        if stats.get("needs_llm_summary"):
            from .context import SUMMARY_SYSTEM as _S
            summary_in = tok(_S) + tok(transcript(older)) + 2 * cost.MSG_OVERHEAD_TOKENS
        scen = cost.scenarios(base_in, search_tokens, summary_in)

        spent = UsageTracker().total_cost()
        remaining = max(config.BUDGET_USD - spent, 0.0)
        typical = next(s for s in scen if s["scenario"] == "typical")["cost_usd"]
        return {
            "question": question,
            "mode": "offline (không tốn tiền)" if self.offline else "llm",
            "model": config.DEEPSEEK_MODEL,
            "price_per_m": {"input": config.PRICE_INPUT_PER_M, "output": config.PRICE_OUTPUT_PER_M},
            "estimation": f"calibrated {cpt:.2f} chars/token from traces" if cpt else
                          "heuristic (ASCII 4 chars/token, non-ASCII 1.5) – chạy vài câu thật để hiệu chỉnh",
            "parts": parts,
            "first_call_input_tokens": base_in,
            "search_result_tokens": search_tokens,
            "history": stats,
            "prefetch_hits": [{"tag": r["tag"], "source_id": r["source_id"], "score": r["score"]}
                              for r in prefetch["results"]],
            "scenarios": scen,
            "budget": {"spent_usd": round(spent, 4), "limit_usd": config.BUDGET_USD,
                       "remaining_usd": round(remaining, 4),
                       "questions_left_typical": int(remaining / typical) if typical else None},
            "messages": messages,
        }

    def _ask_llm(self, question: str, history: list[dict] | None, trace: Trace) -> Answer:
        reg = EvidenceRegistry()
        ans = Answer(question=question, answer="")

        # 1) Nén lịch sử hội thoại
        def summarize(older: list[dict]) -> str:
            msg = self._chat([{"role": "system", "content": SUMMARY_SYSTEM},
                              {"role": "user", "content": transcript(older)}], None, ans, trace, "summarize_history")
            return msg.content or ""

        recent, summary, stats = prepare_history(history, summarize)
        trace.event("compression", **stats)
        ans.conversation_summary = summary

        if summary:
            self._emit({"type": "status", "text": "Summarized earlier conversation turns"})
        self._emit({"type": "status", "text": "Searching documents…"})
        # 2) Truy xuất sơ bộ bằng chính câu hỏi (hữu ích khi câu hỏi tiếng Anh)
        prefetch = self._tool_search_documents(reg, trace, "prefetch", query=question, k=config.TOP_K)
        ans.tool_calls.append({"name": "search_documents(prefetch)", "args": {"query": question},
                               "n_results": prefetch["n_results"]})
        messages = self._build_messages(question, recent, summary, prefetch)

        # 3) Vòng gọi tool
        msg = None
        for round_ in range(config.MAX_TOOL_ROUNDS + 1):
            use_tools = round_ < config.MAX_TOOL_ROUNDS
            msg = self._chat(messages, active_tools() if use_tools else None, ans, trace, "answer", round_)
            calls = getattr(msg, "tool_calls", None) or []
            if not calls:
                break
            if msg.content:
                self._emit({"type": "reset"})
            messages.append({
                "role": "assistant", "content": msg.content or "",
                "tool_calls": [{"id": c.id, "type": "function",
                                "function": {"name": c.function.name, "arguments": c.function.arguments}}
                               for c in calls],
            })
            for c in calls:
                self._emit({"type": "status", "text": _describe_call(c.function.name, c.function.arguments)})
                result = self._run_tool(c.function.name, c.function.arguments, reg, trace)
                ans.tool_calls.append({"name": c.function.name, "args": c.function.arguments,
                                       "n_results": result.get("n_results"), "error": result.get("error")})
                trace.event("tool_call", name=c.function.name, args=c.function.arguments,
                            n_results=result.get("n_results"), error=result.get("error"))
                messages.append({"role": "tool", "tool_call_id": c.id, "content": self._for_llm(result)})

        trace.event("evidence_budget", sent_chars=reg.sent_chars, budget=config.EVIDENCE_CHAR_BUDGET,
                    deduped=reg.deduped, truncated=reg.truncated, searches=reg.searches)
        self._emit({"type": "status", "text": "Checking citations…"})
        self._finalize(ans, (msg.content if msg else "") or "", reg, trace)
        return ans

    @staticmethod
    def _restore_tables(text: str, tables: list[str]) -> tuple[str, int]:
        """Thay mọi bảng trong câu trả lời có cùng hàng tiêu đề với một bảng của tool bằng đúng bảng gốc.
        LLM đôi khi 'sửa' ô bảng dù được dặn chép nguyên văn -> code đảm bảo giá trị luôn khớp metadata."""
        if not tables:
            return text, 0
        by_head = {t.splitlines()[0].strip(): t for t in tables}
        lines, out, changed, i = text.splitlines(), [], 0, 0
        while i < len(lines):
            if lines[i].strip().startswith("|"):
                block = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    block.append(lines[i].strip())
                    i += 1
                orig = by_head.get(block[0])
                if orig:
                    o = orig.splitlines()
                    changed += sum(1 for a, b in zip(block, o) if a != b) + abs(len(block) - len(o))
                    out += o
                else:
                    out += block
                continue
            out.append(lines[i])
            i += 1
        return "\n".join(out), changed

    # ---------- guardrail hậu kiểm ----------
    def _finalize(self, ans: Answer, text: str, reg: EvidenceRegistry, trace: Trace) -> None:
        text = text.strip()
        refused = text.startswith(REFUSAL_MARKER)
        model_refused = refused
        if refused:
            text = text[len(REFUSAL_MARKER):].strip()

        text, restored = self._restore_tables(text, reg.tables)
        if restored:
            ans.warnings.append(f"Restored {restored} comparison-table row(s) edited by the model to the source values.")
            trace.event("table_restored", rows=restored)

        cited: list[str] = []
        invalid: list[str] = []

        def _fix(m: re.Match) -> str:
            refs = [r.strip() for r in re.split(r"[,;]", m.group(1))]
            good = [r for r in refs if r in reg]
            invalid.extend(r for r in refs if r not in reg)
            cited.extend(good)
            return "".join(f"[{r}]" for r in good)

        text = _TAG_GROUP.sub(_fix, text)
        if invalid:
            ans.warnings.append(f"Removed invalid citation tags: {sorted(set(invalid))}")

        forced_refusal = False
        if not refused and not cited:
            ans.warnings.append("Answer had no valid citations; converted to a refusal.")
            refused, text, forced_refusal = True, _refusal_text(ans.question), True
        if refused and not text:
            text = _refusal_text(ans.question)

        ans.answer = text
        ans.refused = refused
        ans.citations = [reg.items[r] for r in dict.fromkeys(cited)]
        ans.uses_mock_data = any(c.is_mock for c in ans.citations)
        if ans.uses_mock_data:
            ans.warnings.append("Answer is based on MOCK placeholder data, not real NASA data.")
        trace.event("guardrail", model_refused=model_refused, forced_refusal=forced_refusal,
                    removed_invalid_tags=sorted(set(invalid)), cited=list(dict.fromkeys(cited)),
                    evidence_available=len(reg.items))

        # Kiểm định từng câu: citation correctness + faithfulness với toàn bộ context (heuristic, miễn phí)
        for c in ans.citations:
            c.evidence = reg.texts.get(c.ref, "")
        v = verify_answer(text, reg.texts)
        ans.verification = v
        suggested = dict.fromkeys(r for x in v["sentences"] for r in x["suggested_refs"] if r not in cited)
        ans.suggested_sources = [replace(reg.items[r], evidence=reg.texts.get(r, "")) for r in suggested]
        unfaithful = v["faithfulness"]["unsupported"]
        if unfaithful:
            ans.warnings.append(f"{unfaithful} sentence(s) are unsupported by any retrieved context "
                                "(possible hallucination or outside knowledge); review them in the verification details.")
        if v["miscited"]:
            ans.warnings.append(f"{v['miscited']} sentence(s) cite the wrong source although the retrieved context "
                                "supports them; see suggested tags.")
        if v["unsupported"] > unfaithful:
            ans.warnings.append(f"{v['unsupported']} sentence(s) look unsupported by their cited sources.")
        trace.event("verification", checked=v["checked"], supported=v["supported"], weak=v["weak"],
                    unsupported=v["unsupported"], uncited=v["uncited"], claims=v["claims"],
                    faithfulness=v["faithfulness"], citation_correctness=v["citation_correctness"],
                    miscited=v["miscited"], inference=v["inference"],
                    flagged=[{k: x[k] for k in ("text", "refs", "overlap", "status", "context_status",
                                                "suggested_refs", "inference", "missing_numbers", "missing_terms")}
                             for x in v["sentences"]
                             if x["status"] != "supported" or x["context_status"] != "supported" or x["inference"]])


_default: Assistant | None = None


def _get_default() -> Assistant:
    global _default
    if _default is None:
        _default = Assistant()
    return _default


def ask(question: str, history: list[dict] | None = None) -> dict:
    """Hàm giao tiếp cho Module 6 / các module khác. Trả dict (JSON-serializable)."""
    return _get_default().ask(question, history).to_dict()


def preview_context(question: str, history: list[dict] | None = None) -> dict:
    """Xem context sẽ gửi cho LLM + ước lượng token/chi phí, KHÔNG gọi LLM (miễn phí)."""
    return _get_default().preview_context(question, history)


def _describe_call(name: str, raw_args: str) -> str:
    """Mô tả ngắn cho người dùng thấy bot đang làm gì (streaming status)."""
    try:
        a = json.loads(raw_args or "{}")
    except json.JSONDecodeError:
        a = {}
    if name == "search_documents":
        return f"Searching documents: “{a.get('query', '')}”" + (f" in {a['source_id']}" if a.get("source_id") else "")
    if name == "compare_investigations":
        return f"Comparing {', '.join(map(str, a.get('investigations', [])))}"
    if name == "rank_investigations":
        return f"Ranking investigations for scenario: {a.get('scenario', '')}"
    if name == "explore_graph":
        return f"Exploring the knowledge graph: {a.get('entity', '')}"
    if name == "search_investigations":
        return "Filtering the investigations table"
    if name == "predict_flammability":
        return "Running the flammability model (Module 5)"
    return f"Calling {name}"
