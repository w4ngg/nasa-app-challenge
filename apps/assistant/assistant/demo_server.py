"""Developer demo UI – interact with the assistant and inspect every function.

  python -m assistant.demo_server            # http://127.0.0.1:8765
  python -m assistant.demo_server --port 9000

Stdlib only (no extra install). Binds to 127.0.0.1 only.
Default mode is OFFLINE (free). DeepSeek is used only when the UI sends mode="llm" AND confirm_paid=true.

Endpoints (JSON):
  GET  /api/status                      data, mode availability, budget, tunable config
  POST /api/ask      {question, history, mode, confirm_paid}
  POST /api/preview  {question, history}                 -> preview_context (free)
  POST /api/search   {query, k, source_id, min_score, mode} -> raw hits, mode = bm25 | dense | hybrid (free)
  POST /api/investigations {query, fuel_type, ...}       -> search_investigations (free)
  GET  /api/traces?n=20 | GET /api/trace/<id>
  POST /api/config   {KEY: value, ...}                   -> change tunables in memory (until restart)
  POST /api/rank     {scenario, need, top_k}             -> rank_investigations tool output (free)
  GET  /api/eval                                         -> saved eval result files + summaries (free)
  GET  /api/eval?file=results_v4_deepseek.jsonl          -> per-question rows of one run (free)
"""
from __future__ import annotations

import json
import re
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import config, integrations
from . import ranking
from .agent import Assistant, EvidenceRegistry
from .llm import BudgetExceeded, UsageTracker
from .trace import get_trace, load_traces

HTML = Path(__file__).parent / "demo" / "index.html"
EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"
_EVAL_FILE = re.compile(r"^results[\w.-]*\.jsonl$")

# Tunables exposed in the UI (name -> type). Changed in memory only.
TUNABLES = {
    "TOP_K": int, "MIN_SCORE": float, "MAX_TOOL_ROUNDS": int, "MAX_SEARCHES": int, "TEMPERATURE": float,
    "HISTORY_KEEP_TURNS": int, "HISTORY_SUMMARY": bool, "EVIDENCE_CHAR_BUDGET": int,
    "OVER_BUDGET_SNIPPET_CHARS": int, "FALLBACK_OFFLINE": bool, "BUDGET_USD": float,
    "RETRIEVER": str, "HYBRID_FUSION": str, "HYBRID_ALPHA": float, "DENSE_MIN_SIM": float, "DENSE_FLOOR": float,
}

_offline: Assistant | None = None
_llm: Assistant | None = None


def offline_bot() -> Assistant:
    global _offline
    if _offline is None:
        _offline = Assistant(offline=True)
    return _offline


def llm_bot() -> Assistant:
    global _llm
    if _llm is None:
        if not config.DEEPSEEK_API_KEY:
            raise RuntimeError("DEEPSEEK_API_KEY is not set in .env")
        _llm = Assistant(offline=False, retriever=offline_bot().retriever)  # share the loaded index
    return _llm


def status() -> dict:
    r = offline_bot().retriever
    sources = sorted({c.source_id for c in r.chunks})
    return {
        "data": {"chunks": len(r.chunks), "sources": len(sources), "uses_mock": r.uses_mock,
                 "source_ids": sources},
        "retriever": {"mode": r.mode, "requested": config.RETRIEVER, "dense_loaded": r.dense is not None,
                      "embed_model": config.EMBED_MODEL if r.dense is not None else None,
                      "fusion": config.HYBRID_FUSION},
        "llm_available": bool(config.DEEPSEEK_API_KEY),
        "model": config.DEEPSEEK_MODEL,
        "price_per_m": {"input": config.PRICE_INPUT_PER_M, "output": config.PRICE_OUTPUT_PER_M},
        "budget": {"spent_usd": round(UsageTracker().total_cost(), 5), "limit_usd": config.BUDGET_USD},
        "config": {k: getattr(config, k) for k in TUNABLES},
    }


def handle(method: str, path: str, query: dict, body: dict) -> tuple[int, dict]:
    if method == "GET" and path == "/api/status":
        return 200, status()
    if method == "GET" and path == "/api/traces":
        n = int(query.get("n", ["20"])[0])
        rows = []
        for t in reversed(load_traces()[-n:]):
            a = t.get("answer") or {}
            rows.append({"trace_id": t["trace_id"], "ts": t["ts"], "mode": t["mode"], "question": t["question"],
                         "refused": a.get("refused"), "n_citations": len(a.get("citations", [])),
                         "error": t.get("error"), **t.get("totals", {})})
        return 200, {"traces": rows}
    if method == "GET" and path.startswith("/api/trace/"):
        t = get_trace(path.rsplit("/", 1)[-1])
        return (200, t) if t else (404, {"error": "trace not found"})

    if method == "POST" and path == "/api/ask":
        q = (body.get("question") or "").strip()
        if not q:
            return 400, {"error": "empty question"}
        try:
            bot = pick_bot(body)
        except PermissionError as e:
            return 400, {"error": str(e)}
        try:
            return 200, bot.ask(q, body.get("history") or []).to_dict()
        except BudgetExceeded as e:
            return 402, {"error": str(e)}
    if method == "POST" and path == "/api/preview":
        bot = llm_bot() if config.DEEPSEEK_API_KEY else offline_bot()
        p = bot.preview_context((body.get("question") or "").strip(), body.get("history") or [])
        p["mode"] = "preview only – no API call made"
        return 200, p
    if method == "POST" and path == "/api/search":
        r = offline_bot().retriever
        mode = (body.get("mode") or r.mode).lower()
        if mode in ("hybrid", "dense") and not r.ensure_dense():
            return 400, {"error": "dense retrieval unavailable: pip install sentence-transformers (see README)"}
        hits = r.search(body.get("query", ""), k=int(body.get("k") or 8),
                        min_score=float(body.get("min_score") if body.get("min_score") not in (None, "") else config.MIN_SCORE),
                        source_id=body.get("source_id") or None, mode=mode)
        det = {d["chunk"]: d for d in r.last_details}
        return 200, {"mode": mode, "hits": [{"chunk": c.id, "source_id": c.source_id, "title": c.title, "section": c.section,
                                             "url": c.url, "score": round(s, 3), "text": c.text,
                                             **{k: v for k, v in det.get(c.id, {}).items() if k != "chunk"}}
                                            for c, s in hits]}
    if method == "POST" and path == "/api/investigations":
        args = {k: v for k, v in body.items() if v not in (None, "")}
        for k in ("min_o2", "max_o2"):
            if k in args:
                args[k] = float(args[k])
        return 200, {"rows": integrations.search_investigations(**args)}
    if method == "GET" and path == "/api/eval":
        name = query.get("file", [""])[0]
        if not name:
            return 200, eval_index()
        try:
            rows = _eval_rows(name)
        except FileNotFoundError:
            return 404, {"error": f"no eval file {name!r}"}
        return 200, {"file": name, "summary": _eval_summary(rows),
                     "rows": [{k: r.get(k) for k in _EVAL_KEEP} for r in rows]}
    if method == "POST" and path == "/api/rank":
        bot = offline_bot()
        reg = EvidenceRegistry()
        res = bot._tool_rank(reg, body.get("scenario") or "", body.get("need") or None, int(body.get("top_k") or 5))
        if "error" in res:
            return 400, res
        key = ranking.resolve_scenario(body.get("scenario"))
        res["scenario_key"] = key
        res["focus"] = list(ranking.SCENARIOS[key]["focus"])
        res["scenarios"] = {k: v["label"] for k, v in ranking.SCENARIOS.items()}
        res["needs"] = list(ranking.NEEDS)
        return 200, res
    if method == "POST" and path == "/api/config":
        changed = {}
        for k, v in body.items():
            if k not in TUNABLES:
                return 400, {"error": f"not tunable: {k}"}
            typ = TUNABLES[k]
            val = (v in (True, "true", "1", 1)) if typ is bool else typ(v)
            setattr(config, k, val)
            changed[k] = val
        if changed.get("RETRIEVER") in ("hybrid", "dense") and not offline_bot().retriever.ensure_dense():
            config.RETRIEVER = "bm25"
            return 400, {"error": "dense retrieval unavailable: pip install sentence-transformers (see README)"}
        offline_bot().retriever.requested_mode = config.RETRIEVER
        return 200, {"changed": changed, "config": {k: getattr(config, k) for k in TUNABLES}}
    return 404, {"error": "not found"}


def _mean(xs: list) -> float | None:
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(sum(xs) / len(xs), 3) if xs else None


def _eval_rows(name: str) -> list[dict]:
    if not _EVAL_FILE.match(name) or not (EVAL_DIR / name).is_file():
        raise FileNotFoundError(name)
    rows = []
    for line in (EVAL_DIR / name).read_text(encoding="utf-8").split("\n"):
        if line.strip():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _eval_summary(rows: list[dict]) -> dict:
    crit = [r.get("criteria") or {} for r in rows]
    return {
        "n": len(rows), "passed": sum(bool(r.get("ok")) for r in rows),
        "offline": not any(r.get("cost_usd") for r in rows),
        "faithfulness": _mean([c.get("faithfulness") for c in crit]),
        "citation_correctness": _mean([c.get("citation_correctness") for c in crit]),
        "answer_correctness": _mean([c.get("answer_correctness") for c in crit]),
        "unfaithful": sum(c.get("unfaithful") or 0 for c in crit), "miscited": sum(c.get("miscited") or 0 for c in crit),
        "cost_usd": round(sum(r.get("cost_usd") or 0 for r in rows), 5),
        "latency_ms": _mean([r.get("latency_ms") for r in rows]), "searches": _mean([r.get("searches") for r in rows]),
        "categories": sorted({r.get("category", "") for r in rows}),
    }


def eval_index() -> dict:
    files = []
    for f in sorted(EVAL_DIR.glob("results*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
        if _EVAL_FILE.match(f.name):
            files.append({"file": f.name, **_eval_summary(_eval_rows(f.name))})
    qs = []
    qfile = EVAL_DIR / "questions.jsonl"
    if qfile.is_file():
        for line in qfile.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                q = json.loads(line)
                qs.append({k: q.get(k) for k in ("id", "category", "question", "expect", "history")})
    return {"files": files, "questions": qs}


_EVAL_KEEP = ("id", "category", "question", "expect", "got", "ok", "behavior_ok", "source_ok", "tool_ok", "english_ok",
              "criteria", "facts", "answer", "refused", "cost_usd", "latency_ms", "searches", "tool_calls", "warnings",
              "trace_id", "expect_sources")


def pick_bot(body: dict) -> Assistant:
    if body.get("mode") == "llm":
        if not body.get("confirm_paid"):
            raise PermissionError("DeepSeek mode requires confirm_paid=true (this call costs quota)")
        return llm_bot()
    return offline_bot()


class Handler(BaseHTTPRequestHandler):
    def _stream_ask(self, body: dict) -> None:
        """POST /api/ask_stream -> Server-Sent Events: status / delta / reset ..., rồi done (câu trả lời cuối)."""
        q = (body.get("question") or "").strip()
        if not q:
            return self._send(400, b'{"error":"empty question"}', "application/json")
        try:
            bot = pick_bot(body)
        except (PermissionError, RuntimeError) as e:
            return self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True

        def send(event: dict) -> None:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n".encode())
            self.wfile.flush()

        try:
            ans = bot.ask(q, body.get("history") or [], on_event=send)
            send({"type": "done", "answer": ans.to_dict()})
        except BudgetExceeded as e:
            send({"type": "error", "error": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                send({"type": "error", "error": f"{type(e).__name__}: {e}"})
            except OSError:
                pass

    def _send(self, code: int, payload: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _dispatch(self, method: str) -> None:
        url = urlparse(self.path)
        if method == "GET" and url.path in ("/", "/index.html"):
            return self._send(200, HTML.read_bytes(), "text/html; charset=utf-8")
        body = {}
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, b'{"error":"invalid JSON"}', "application/json")
            if url.path == "/api/ask_stream":
                return self._stream_ask(body)
        try:
            code, data = handle(method, url.path, parse_qs(url.query), body)
        except Exception as e:  # show the error in the UI instead of a dead request
            code, data = 500, {"error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc()[-2000:]}
        self._send(code, json.dumps(data, ensure_ascii=False, default=str).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write(f"  {args[0]} -> {args[1]}\n")


def main() -> None:
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8765
    offline_bot()  # load the index once at startup
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Demo UI: http://127.0.0.1:{port}  (default mode OFFLINE = free; Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
