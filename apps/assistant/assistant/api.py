"""HTTP API để Module 6 (Đăng) gọi. Chạy: uvicorn assistant.api:app --reload --port 8003

POST /ask  {"question": "...", "history": [{"role": "user", "content": "..."}, ...]}
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

from .agent import _get_default, ask, preview_context
from .llm import BudgetExceeded

app = FastAPI(title="AstroFlame AI Research Assistant")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Turn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[Turn] = []


@app.get("/health")
def health() -> dict:
    from . import config
    offline = config.OFFLINE_MODE == "1" or (config.OFFLINE_MODE == "auto" and not config.DEEPSEEK_API_KEY)
    return {"ok": True, "mode": "offline" if offline else "llm", "model": None if offline else config.DEEPSEEK_MODEL}


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
    try:
        return ask(req.question, [t.model_dump() for t in req.history])
    except BudgetExceeded as e:
        raise HTTPException(status_code=402, detail=str(e))


@app.post("/ask/stream")
def ask_stream_endpoint(req: AskRequest) -> StreamingResponse:
    """Như /ask nhưng hiển thị dần (Server-Sent Events). Client đọc từng dòng `data: {...}`."""
    events: queue.Queue = queue.Queue()
    history = [t.model_dump() for t in req.history]

    def work() -> None:
        try:
            ans = _get_default().ask(req.question, history, on_event=events.put)
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
