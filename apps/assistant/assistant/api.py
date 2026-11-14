"""HTTP API để Module 6 (Đăng) gọi. Chạy: uvicorn assistant.api:app --reload --port 8003

POST /ask  {"question": "...", "history": [{"role": "user", "content": "..."}, ...], "mode": "offline"|"llm"|null,
            "confirm_paid": false}
     mode = null: như trước (LLM nếu có DEEPSEEK_API_KEY trong .env, không thì offline).
     mode = "llm" bắt buộc confirm_paid = true (gọi DeepSeek tốn quota) -> tránh web vô tình tiêu tiền.
     API key chỉ nằm ở server (.env), không bao giờ gửi cho trình duyệt.
-> {"answer", "citations": [...], "refused", "uses_mock_data", "warnings", "tool_calls", "cost_usd", "trace_id", ...}
POST /ask/stream (cùng body) -> text/event-stream: data: {"type": "status"|"delta"|"reset"|"done"|"error", ...}
     "delta" = đoạn chữ đang sinh; "done" chứa câu trả lời cuối đã hậu kiểm (dùng cái này để hiển thị bản chốt)
POST /context  (cùng body)  -> context sẽ gửi cho LLM + ước lượng token/chi phí, không gọi LLM
GET  /trace/{trace_id}
"""
from __future__ import annotations

import json
import queue
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import config
from .agent import Assistant, _get_default, preview_context
from .llm import BudgetExceeded, UsageTracker

app = FastAPI(title="AstroFlame AI Research Assistant")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Turn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[Turn] = []
    mode: str | None = None          # "offline" | "llm" | None (mặc định theo .env)
    confirm_paid: bool = False       # bắt buộc true khi mode = "llm"


_offline_bot: Assistant | None = None


def _llm_available() -> bool:
    return bool(config.DEEPSEEK_API_KEY) and config.OFFLINE_MODE != "1"


def _bot_for(req: AskRequest) -> Assistant:
    """Chọn bot theo mode; mode = llm phải có confirm_paid (400 nếu thiếu, 503 nếu server không có key)."""
    global _offline_bot
    if req.mode == "llm":
        if not _llm_available():
            raise HTTPException(status_code=503, detail="DeepSeek is not configured on this server (no API key in .env)")
        if not req.confirm_paid:
            raise HTTPException(status_code=400, detail="mode=llm calls DeepSeek and costs quota: send confirm_paid=true")
        bot = _get_default()
        return bot if not bot.offline else Assistant(offline=False, retriever=bot.retriever)
    if req.mode == "offline":
        if _offline_bot is None:
            _offline_bot = Assistant(offline=True, retriever=_get_default().retriever)
        return _offline_bot
    return _get_default()


@app.get("/health")
def health() -> dict:
    from . import config
    offline = config.OFFLINE_MODE == "1" or (config.OFFLINE_MODE == "auto" and not config.DEEPSEEK_API_KEY)
    tracker = UsageTracker()
    return {"ok": True, "mode": "offline" if offline else "llm", "model": None if offline else config.DEEPSEEK_MODEL,
            "llm_available": _llm_available(), "llm_model": config.DEEPSEEK_MODEL if _llm_available() else None,
            "budget": {"spent_usd": round(tracker.total_cost(), 4), "limit_usd": config.BUDGET_USD},
            "price_per_m": {"input": config.PRICE_INPUT_PER_M, "output": config.PRICE_OUTPUT_PER_M},
            "retriever": getattr(_get_default().retriever, "mode", "bm25")}


@app.get("/trace/{trace_id}")
def trace_endpoint(trace_id: str) -> dict:
    """Xem trace của 1 request (dùng trace_id trả về từ /ask). Chỉ nên bật khi dev/demo nội bộ."""
    from .trace import get_trace
    t = get_trace(trace_id)
    if not t:
        raise HTTPException(status_code=404, detail="trace not found")
    return t


@app.post("/context")
def context_endpoint(req: AskRequest, include_messages: bool = False) -> dict:
    """Xem trước context + ước lượng token/chi phí cho 1 câu hỏi. KHÔNG gọi LLM, không tốn tiền."""
    p = preview_context(req.question, [t.model_dump() for t in req.history])
    if not include_messages:
        p.pop("messages", None)
    return p


@app.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    bot = _bot_for(req)
    try:
        return bot.ask(req.question, [t.model_dump() for t in req.history]).to_dict()
    except BudgetExceeded as e:
        raise HTTPException(status_code=402, detail=str(e))


@app.post("/ask/stream")
def ask_stream_endpoint(req: AskRequest) -> StreamingResponse:
    """Như /ask nhưng hiển thị dần (Server-Sent Events). Client đọc từng dòng `data: {...}`."""
    events: queue.Queue = queue.Queue()
    history = [t.model_dump() for t in req.history]
    bot = _bot_for(req)  # lỗi mode/confirm_paid trả HTTP 400/503 trước khi mở stream

    def work() -> None:
        try:
            ans = bot.ask(req.question, history, on_event=events.put)
            events.put({"type": "done", "answer": ans.to_dict()})
        except BudgetExceeded as e:
            events.put({"type": "error", "error": str(e), "status": 402})
        except Exception as e:  # noqa: BLE001
            events.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
        finally:
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def gen():
        while (e := events.get()) is not None:
            yield f"data: {json.dumps(e, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})
