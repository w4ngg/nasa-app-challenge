"""Ước lượng token và chi phí trước khi gọi DeepSeek.

Không có tokenizer DeepSeek chạy local, nên dùng heuristic:
  - ký tự ASCII (tiếng Anh, JSON): ~4 ký tự / token
  - ký tự ngoài ASCII (tiếng Việt có dấu, ký hiệu): ~1.5 ký tự / token
Khi logs/traces.jsonl đã có lượt gọi thật, hệ số ký tự/token được hiệu chỉnh từ số token DeepSeek trả về
(xem calibrate()). Đây là ƯỚC LƯỢNG – số chính xác chỉ có sau khi gọi (cost_usd trong Answer/trace).
"""
from __future__ import annotations

import json
import math
import os

from . import config

MSG_OVERHEAD_TOKENS = 4          # token định dạng cho mỗi message
TOOL_CALL_OUTPUT_TOKENS = 60     # output của 1 lượt LLM chỉ gọi tool
ANSWER_OUTPUT_TOKENS = int(os.getenv("ANSWER_OUTPUT_TOKENS_EST", "450"))   # độ dài câu trả lời cuối ước lượng
SUMMARY_OUTPUT_TOKENS = 160


def calibrate() -> float | None:
    """Ký tự / token thực tế, tính từ các lượt gọi DeepSeek đã ghi trong trace. None nếu chưa có dữ liệu."""
    from .trace import load_traces
    chars = tokens = 0
    for t in load_traces()[-200:]:
        for e in t.get("events", []):
            if e.get("kind") == "llm_call" and e.get("prompt_tokens"):
                chars += (e.get("context_chars") or 0) + (e.get("tools_chars") or 0)
                tokens += e["prompt_tokens"] - MSG_OVERHEAD_TOKENS * (e.get("n_messages") or 0)
    return chars / tokens if tokens > 500 else None


def estimate_tokens(text: str, chars_per_token: float | None = None) -> int:
    if not text:
        return 0
    if chars_per_token:
        return math.ceil(len(text) / chars_per_token)
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return math.ceil((len(text) - non_ascii) / 4 + non_ascii / 1.5)


def messages_tokens(messages: list[dict], cpt: float | None = None) -> int:
    return sum(estimate_tokens(str(m.get("content") or ""), cpt) + MSG_OVERHEAD_TOKENS for m in messages)


def tools_tokens(tools: list | None, cpt: float | None = None) -> int:
    return estimate_tokens(json.dumps(tools, ensure_ascii=False), cpt) if tools else 0


def usd(tokens_in: int, tokens_out: int) -> float:
    return tokens_in / 1e6 * config.PRICE_INPUT_PER_M + tokens_out / 1e6 * config.PRICE_OUTPUT_PER_M


def scenarios(base_in: int, search_result_tokens: int, summary_in: int = 0) -> list[dict]:
    """3 kịch bản cho 1 câu hỏi.

    base_in: token input của lượt gọi đầu (messages + tool schema)
    search_result_tokens: token của 1 kết quả search_documents điển hình
    summary_in: token input nếu phải gọi LLM tóm tắt lịch sử (0 nếu không)
    Mỗi vòng tool, toàn bộ hội thoại được gửi lại -> input tăng dần. Bằng chứng bị chặn bởi EVIDENCE_CHAR_BUDGET.
    """
    budget_tokens = config.EVIDENCE_CHAR_BUDGET // 4
    snippet_tokens = max(config.OVER_BUDGET_SNIPPET_CHARS // 4 * 5, 1)
    out = []
    for name, rounds in (("direct", 0), ("typical", 1), ("worst", config.MAX_TOOL_ROUNDS)):
        tin = tout = calls = 0
        ctx, evidence = base_in, 0
        for _ in range(rounds):  # các lượt LLM gọi tool
            tin += ctx
            tout += TOOL_CALL_OUTPUT_TOKENS
            calls += 1
            add = search_result_tokens if evidence + search_result_tokens <= budget_tokens else snippet_tokens
            evidence += add
            ctx += TOOL_CALL_OUTPUT_TOKENS + add
        tin += ctx                # lượt trả lời cuối
        tout += ANSWER_OUTPUT_TOKENS
        calls += 1
        if summary_in:
            tin += summary_in
            tout += SUMMARY_OUTPUT_TOKENS
            calls += 1
        out.append({"scenario": name, "tool_rounds": rounds, "llm_calls": calls, "input_tokens": tin,
                    "output_tokens": tout, "cost_usd": round(usd(tin, tout), 6)})
    return out
