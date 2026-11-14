"""Nén context gửi cho LLM.

1. Lịch sử hội thoại: giữ nguyên văn HISTORY_KEEP_TURNS lượt gần nhất; các lượt cũ hơn được tóm tắt
   (bằng LLM nếu có, nếu không thì trích các câu hỏi cũ). Tóm tắt được cache theo nội dung.
2. Xóa nhãn trích dẫn [S1]/[I2]/[P1] khỏi lịch sử: nhãn chỉ có nghĩa trong request đã tạo ra nó,
   để lại sẽ khiến LLM dùng nhầm nhãn cũ cho tài liệu mới.
3. Ngân sách bằng chứng: xem EvidenceRegistry trong agent.py (lọc trùng + cắt khi vượt ngân sách).
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Callable

from . import config

_TAG = re.compile(r"\[[SIP]\d+\]")
_CACHE: dict[str, str] = {}
_CACHE_MAX = 256

SUMMARY_SYSTEM = (
    "Summarize the earlier part of a conversation between a user and a NASA microgravity-combustion research "
    "assistant in at most 120 words, in English. Keep: investigations discussed (PSI IDs, acronyms), materials "
    "and conditions mentioned, the user's goals and open questions. Do not add facts that are not in the text."
)


def clean_message(m: dict) -> dict | None:
    if m.get("role") not in ("user", "assistant") or not m.get("content"):
        return None
    text = _TAG.sub("", str(m["content"])).strip()
    if len(text) > config.HISTORY_MSG_MAX_CHARS:
        text = text[:config.HISTORY_MSG_MAX_CHARS] + " …"
    return {"role": m["role"], "content": text}


def extractive_summary(older: list[dict]) -> str:
    questions = [m["content"][:150] for m in older if m["role"] == "user"][-6:]
    return "Earlier user questions: " + " | ".join(questions) if questions else ""


def prepare_history(history: list[dict] | None,
                    summarize_fn: Callable[[list[dict]], str] | None = None,
                    dry_run: bool = False) -> tuple[list[dict], str, dict]:
    """Trả về (tin nhắn gần đây giữ nguyên, tóm tắt phần cũ, thống kê cho trace).

    dry_run=True (dùng cho preview_context): không gọi LLM, không ghi cache. Nếu request thật sẽ phải
    tóm tắt bằng LLM thì stats["needs_llm_summary"]=True và `older` được trả trong stats để ước lượng chi phí.
    """
    msgs = [c for c in (clean_message(m) for m in (history or [])) if c]
    keep = max(config.HISTORY_KEEP_TURNS, 0) * 2
    recent = msgs[-keep:] if keep else []
    older = msgs[:-keep] if keep else msgs
    summary, method = "", "none"
    needs_llm_summary = False
    if older:
        key = hashlib.sha1(json.dumps(older, ensure_ascii=False).encode()).hexdigest()
        if key in _CACHE:
            summary, method = _CACHE[key], "cache"
        elif dry_run:
            needs_llm_summary = config.HISTORY_SUMMARY
            summary, method = extractive_summary(older), "preview_extractive"
        else:
            if summarize_fn and config.HISTORY_SUMMARY:
                try:
                    summary, method = (summarize_fn(older) or "").strip(), "llm"
                except Exception:
                    summary = ""
            if not summary:
                summary, method = extractive_summary(older), "extractive"
            if len(_CACHE) >= _CACHE_MAX:
                _CACHE.clear()
            _CACHE[key] = summary
    stats = {"history_in": len(msgs), "kept": len(recent), "summarized": len(older),
             "method": method, "summary_chars": len(summary)}
    if dry_run:
        stats["needs_llm_summary"] = needs_llm_summary
        stats["older_messages"] = older
    return recent, summary, stats


def transcript(msgs: list[dict]) -> str:
    return "\n".join(f"{m['role'].upper()}: {m['content']}" for m in msgs)
