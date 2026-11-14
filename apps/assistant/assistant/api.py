"""HTTP API để Module 6 (Đăng) gọi. Chạy: uvicorn assistant.api:app --reload --port 8003

POST /ask  {"question": "...", "history": [{"role": "user", "content": "..."}, ...]}
-> {"answer", "citations": [...], "refused", "uses_mock_data", "warnings", "tool_calls", "cost_usd"}
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .agent import ask
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
    return {"ok": True}


@app.get("/trace/{trace_id}")
def trace_endpoint(trace_id: str) -> dict:
    """Xem trace của 1 request (dùng trace_id trả về từ /ask). Chỉ nên bật khi dev/demo nội bộ."""
    from .trace import get_trace
    t = get_trace(trace_id)
    if not t:
        raise HTTPException(status_code=404, detail="trace not found")
    return t


@app.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    try:
        return ask(req.question, [t.model_dump() for t in req.history])
    except BudgetExceeded as e:
        raise HTTPException(status_code=402, detail=str(e))
