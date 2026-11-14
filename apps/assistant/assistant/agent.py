"""Agent hỏi đáp có trích dẫn: ask(question) -> Answer.

Luồng: nén lịch sử -> truy xuất sơ bộ -> DeepSeek gọi tool (search_documents / search_investigations /
predict_flammability) -> trả lời kèm nhãn [S#]/[I#]/[P#] -> hậu kiểm trích dẫn (guardrail).
Mọi bước được ghi vào trace (assistant/trace.py).
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from . import config, integrations
from .context import SUMMARY_SYSTEM, prepare_history, transcript
from .prompts import REFUSAL_MARKER, SYSTEM_PROMPT, TOOLS
from .retriever import DocumentRetriever, expand_query
from .schema import Answer, Citation
from .trace import Trace

OFFLINE_TOP_K = 3
_STUDY_WORDS = ("nghiên cứu", "thí nghiệm", "investigation", "study", "studies", "experiment")

_TAG_GROUP = re.compile(r"\[((?:[SIP]\d+)(?:\s*[,;]\s*[SIP]\d+)*)\]")
_VI_CHARS = re.compile(r"[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]", re.I)


def _is_vietnamese(text: str) -> bool:
    return bool(_VI_CHARS.search(text))


def _refusal_text(question: str) -> str:
    if _is_vietnamese(question):
        return ("Mình chưa tìm thấy bằng chứng trong dữ liệu NASA đã nạp để trả lời câu này. "
                "Bạn thử hỏi cụ thể hơn (tên thí nghiệm, vật liệu, nồng độ O₂...) hoặc bổ sung tài liệu nguồn.")
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
        self._counters = {"S": 0, "I": 0, "P": 0}
        self.sent_chunks: set[str] = set()
        self.sent_chars = 0
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
        msg, cost = self.llm.chat(messages, tools=tools)
        usage = getattr(self.llm, "last_usage", None) or {}
        ans.cost_usd += cost
        ans.prompt_tokens += usage.get("prompt_tokens", 0)
        ans.completion_tokens += usage.get("completion_tokens", 0)
        trace.event("llm_call", purpose=purpose, round=round_, latency_ms=int((time.perf_counter() - t0) * 1000),
                    prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"),
                    cache_hit_tokens=usage.get("cache_hit_tokens"), cost_usd=round(cost, 6),
                    context_chars=sum(len(str(m.get("content") or "")) for m in messages),
                    n_messages=len(messages), n_tool_calls=len(getattr(msg, "tool_calls", None) or []))
        return msg

    # ---------- tools ----------
    def _tool_search_documents(self, reg: EvidenceRegistry, trace: Trace | None, origin: str,
                               query: str, source_id: str | None = None, k: int = 5) -> dict:
        k = max(1, min(int(k or 5), 8))
        hits = self.retriever.search(query, k=k, source_id=source_id)
        results = []
        for chunk, score in hits:
            ref = reg.add("S", "document", ("S", chunk.id), source_id=chunk.source_id, title=chunk.title,
                          url=chunk.url, snippet=chunk.text[:300], is_mock=chunk.is_mock)
            text, status = reg.take_text(chunk.id, chunk.text)
            item = {"tag": f"[{ref}]", "source_id": chunk.source_id, "title": chunk.title,
                    "section": chunk.section, "score": round(score, 2), "is_mock": chunk.is_mock}
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
                        hits=[{"tag": r["tag"], "chunk": c.id, "score": round(s, 2)} for r, (c, s) in zip(results, hits)],
                        evidence_chars_sent=reg.sent_chars)
        return {"query": query, "n_results": len(results), "results": results}

    def _tool_search_investigations(self, reg: EvidenceRegistry, **kwargs: Any) -> dict:
        rows = integrations.search_investigations(**kwargs)
        out = []
        for r in rows:
            ref = reg.add("I", "investigation", ("I", r.get("psi_id")), source_id=str(r.get("psi_id", "")),
                          title=str(r.get("name", "")), url=str(r.get("link", "")),
                          snippet=str(r.get("description", ""))[:300], is_mock=bool(r.get("is_mock")))
            out.append({"tag": f"[{ref}]", **r})
        return {"filters": kwargs, "n_results": len(out), "results": out}

    def _tool_predict(self, reg: EvidenceRegistry, **kwargs: Any) -> dict:
        res = integrations.predict(**kwargs)
        ref = reg.add("P", "prediction", ("P", json.dumps(kwargs, sort_keys=True)),
                      source_id=str(res.get("model", "module5")), title="Module 5 prediction",
                      snippet=json.dumps(res.get("inputs", kwargs))[:300], is_mock=bool(res.get("is_mock")))
        return {"tag": f"[{ref}]", **res}

    def _run_tool(self, name: str, raw_args: str, reg: EvidenceRegistry, trace: Trace) -> dict:
        try:
            args = json.loads(raw_args or "{}")
            if name == "search_documents":
                return self._tool_search_documents(reg, trace, "tool", **args)
            if name == "search_investigations":
                return self._tool_search_investigations(reg, **args)
            if name == "predict_flammability":
                return self._tool_predict(reg, **args)
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
    def ask(self, question: str, history: list[dict] | None = None) -> Answer:
        trace = Trace(question, mode="offline" if self.offline else "llm", history_len=len(history or []))
        try:
            if self.offline:
                ans = self._ask_offline(question, trace)
            else:
                try:
                    ans = self._ask_llm(question, history, trace)
                except Exception as e:
                    if not config.FALLBACK_OFFLINE:
                        raise
                    trace.event("fallback", error=f"{type(e).__name__}: {e}")
                    ans = self._ask_offline(question, trace)
                    ans.warnings.insert(0, f"Gọi DeepSeek lỗi ({type(e).__name__}: {e}) -> đã chuyển sang chế độ offline.")
        except Exception as e:
            trace.finish(error=f"{type(e).__name__}: {e}")
            raise
        ans.trace_id = trace.id
        ans.latency_ms = trace.elapsed_ms()
        trace.finish(ans)
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

        vi = _is_vietnamese(question)
        if not docs["results"] and not rows:
            text = REFUSAL_MARKER
        else:
            lines = ["Các đoạn liên quan nhất trong dữ liệu (chế độ offline, chưa được AI tổng hợp):" if vi else
                     "Most relevant passages found (offline mode, not synthesized by AI):"]
            for r in docs["results"]:
                full = r["_full_text"]
                snippet = full if len(full) <= 400 else full[:400].rsplit(" ", 1)[0] + "…"
                head = f"{r['title']}" + (f" – {r['section']}" if r.get("section") else "")
                lines.append(f"- **{head}**: {snippet} {r['tag']}")
            if rows:
                lines.append("\nNghiên cứu có thể liên quan:" if vi else "\nPossibly related investigations:")
                for r in rows:
                    lines.append(f"- {r.get('psi_id')} – {r.get('name')}: {r.get('description', '')} {r['tag']}")
            text = "\n".join(lines)

        self._finalize(ans, text, reg, trace)
        ans.warnings.insert(0, "Chế độ offline: không dùng LLM, chỉ trích đoạn tài liệu khớp nhất (BM25).")
        return ans

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

        # 2) Truy xuất sơ bộ bằng chính câu hỏi (hữu ích khi câu hỏi tiếng Anh)
        prefetch = self._tool_search_documents(reg, trace, "prefetch", query=question, k=config.TOP_K)
        ans.tool_calls.append({"name": "search_documents(prefetch)", "args": {"query": question},
                               "n_results": prefetch["n_results"]})
        user_content = question
        if prefetch["n_results"]:
            user_content += ("\n\n<prefetched_passages note=\"may be irrelevant; search again if needed\">\n"
                             + self._for_llm(prefetch) + "\n</prefetched_passages>")

        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if summary:
            messages.append({"role": "system", "content":
                             f"Summary of the earlier conversation (context only, NOT evidence, do not cite): {summary}"})
        messages += recent
        messages.append({"role": "user", "content": user_content})

        # 3) Vòng gọi tool
        msg = None
        for round_ in range(config.MAX_TOOL_ROUNDS + 1):
            use_tools = round_ < config.MAX_TOOL_ROUNDS
            msg = self._chat(messages, TOOLS if use_tools else None, ans, trace, "answer", round_)
            calls = getattr(msg, "tool_calls", None) or []
            if not calls:
                break
            messages.append({
                "role": "assistant", "content": msg.content or "",
                "tool_calls": [{"id": c.id, "type": "function",
                                "function": {"name": c.function.name, "arguments": c.function.arguments}}
                               for c in calls],
            })
            for c in calls:
                result = self._run_tool(c.function.name, c.function.arguments, reg, trace)
                ans.tool_calls.append({"name": c.function.name, "args": c.function.arguments,
                                       "n_results": result.get("n_results"), "error": result.get("error")})
                trace.event("tool_call", name=c.function.name, args=c.function.arguments,
                            n_results=result.get("n_results"), error=result.get("error"))
                messages.append({"role": "tool", "tool_call_id": c.id, "content": self._for_llm(result)})

        trace.event("evidence_budget", sent_chars=reg.sent_chars, budget=config.EVIDENCE_CHAR_BUDGET,
                    deduped=reg.deduped, truncated=reg.truncated)
        self._finalize(ans, (msg.content if msg else "") or "", reg, trace)
        return ans

    # ---------- guardrail hậu kiểm ----------
    def _finalize(self, ans: Answer, text: str, reg: EvidenceRegistry, trace: Trace) -> None:
        text = text.strip()
        refused = text.startswith(REFUSAL_MARKER)
        model_refused = refused
        if refused:
            text = text[len(REFUSAL_MARKER):].strip()

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
            ans.warnings.append(f"Đã xóa trích dẫn không hợp lệ: {sorted(set(invalid))}")

        forced_refusal = False
        if not refused and not cited:
            ans.warnings.append("Câu trả lời không có trích dẫn hợp lệ -> chuyển thành từ chối.")
            refused, text, forced_refusal = True, _refusal_text(ans.question), True
        if refused and not text:
            text = _refusal_text(ans.question)

        ans.answer = text
        ans.refused = refused
        ans.citations = [reg.items[r] for r in dict.fromkeys(cited)]
        ans.uses_mock_data = any(c.is_mock for c in ans.citations)
        if ans.uses_mock_data:
            ans.warnings.append("Câu trả lời dựa trên dữ liệu MOCK, chưa phải dữ liệu NASA thật.")
        trace.event("guardrail", model_refused=model_refused, forced_refusal=forced_refusal,
                    removed_invalid_tags=sorted(set(invalid)), cited=list(dict.fromkeys(cited)),
                    evidence_available=len(reg.items))


_default: Assistant | None = None


def ask(question: str, history: list[dict] | None = None) -> dict:
    """Hàm giao tiếp cho Module 6 / các module khác. Trả dict (JSON-serializable)."""
    global _default
    if _default is None:
        _default = Assistant()
    return _default.ask(question, history).to_dict()
