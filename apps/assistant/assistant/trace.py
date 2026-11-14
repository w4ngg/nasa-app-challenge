"""Trace từng request: ghi 1 dòng JSON vào logs/traces.jsonl.

Mỗi trace gồm các event theo thời gian:
  compression  – nén lịch sử hội thoại (bao nhiêu tin giữ / tóm tắt, cách tóm tắt)
  retrieval    – mỗi lần tìm đoạn văn: query, nguồn gọi (prefetch/tool/offline), id + điểm từng đoạn
  llm_call     – mỗi lần gọi DeepSeek: mục đích, token vào/ra, thời gian, chi phí, độ dài context
  tool_call    – mỗi lần LLM gọi tool: tên, tham số, số kết quả, lỗi
  guardrail    – hậu kiểm trích dẫn: nhãn bị xóa, có bị chuyển thành từ chối không
  fallback     – DeepSeek lỗi, chuyển sang offline
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from . import config

_lock = threading.Lock()


class Trace:
    def __init__(self, question: str, mode: str, history_len: int = 0):
        self.id = uuid.uuid4().hex[:12]
        self.ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.question = question
        self.mode = mode
        self.history_len = history_len
        self.events: list[dict] = []
        self._t0 = time.perf_counter()

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._t0) * 1000)

    def event(self, kind: str, **data: Any) -> None:
        self.events.append({"t_ms": self.elapsed_ms(), "kind": kind, **data})

    def totals(self) -> dict:
        calls = [e for e in self.events if e["kind"] == "llm_call"]
        return {
            "latency_ms": self.elapsed_ms(),
            "llm_calls": len(calls),
            "prompt_tokens": sum(e.get("prompt_tokens") or 0 for e in calls),
            "completion_tokens": sum(e.get("completion_tokens") or 0 for e in calls),
            "cost_usd": round(sum(e.get("cost_usd") or 0.0 for e in calls), 6),
        }

    def finish(self, answer: Any = None, error: str | None = None) -> dict:
        record = {
            "trace_id": self.id, "ts": self.ts, "mode": self.mode, "question": self.question,
            "history_len": self.history_len, "events": self.events, "totals": self.totals(),
        }
        if answer is not None:
            record["answer"] = {
                "text": answer.answer, "refused": answer.refused,
                "citations": [{"ref": c.ref, "source_id": c.source_id, "kind": c.kind} for c in answer.citations],
                "warnings": answer.warnings,
            }
        if error:
            record["error"] = error
        if config.TRACE_ENABLED:
            config.TRACE_FILE.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(record, ensure_ascii=False, default=str)
            with _lock, open(config.TRACE_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        return record


def load_traces() -> list[dict]:
    if not config.TRACE_FILE.exists():
        return []
    with open(config.TRACE_FILE, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def get_trace(trace_id: str) -> dict | None:
    for t in reversed(load_traces()):
        if t["trace_id"].startswith(trace_id):
            return t
    return None
