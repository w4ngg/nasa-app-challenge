"""Chat thử trên terminal: python -m assistant.cli [--debug] [--offline]"""
from __future__ import annotations

import sys

from .agent import Assistant
from .context_view import render
from .llm import UsageTracker


def main() -> None:
    debug = "--debug" in sys.argv
    bot = Assistant(offline=True if "--offline" in sys.argv else None)
    if bot.offline:
        print("ℹ️  Chế độ OFFLINE (không có DEEPSEEK_API_KEY hoặc dùng --offline): chỉ trích đoạn tài liệu, không gọi LLM.\n")
    if bot.retriever.uses_mock:
        print("⚠️  Đang dùng dữ liệu MOCK (data/mock/). Chạy `python -m assistant.ingest` khi có tài liệu thật.\n")
    history: list[dict] = []
    print("AstroFlame Research Assistant — gõ 'exit' để thoát.")
    print("Lệnh: /context <câu hỏi> xem context + ước lượng chi phí (không gọi LLM); "
          "/context! <câu hỏi> in kèm toàn bộ messages.\n")
    while True:
        try:
            q = input("Bạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if q.lower() in {"exit", "quit", "q"}:
            break
        if not q:
            continue
        if q.startswith("/context"):
            full = q.startswith("/context!")
            question = q.split(maxsplit=1)[1] if " " in q else ""
            if not question:
                print("Cách dùng: /context <câu hỏi>\n")
                continue
            print("\n" + render(bot.preview_context(question, history), full=full) + "\n")
            continue
        a = bot.ask(q, history)
        print(f"\nAssistant{' (từ chối)' if a.refused else ''}:\n{a.answer}\n")
        for c in a.citations:
            print(f"  [{c.ref}] {c.source_id} — {c.title}{' (MOCK)' if c.is_mock else ''} {c.url}")
        for w in a.warnings:
            print(f"  ⚠️  {w}")
        if debug:
            for t in a.tool_calls:
                print(f"  · tool {t}")
        if a.conversation_summary and debug:
            print(f"  · tóm tắt hội thoại cũ: {a.conversation_summary}")
        print(f"  💲 lượt này ${a.cost_usd:.5f} | tổng ${UsageTracker().total_cost():.4f} | "
              f"{a.latency_ms}ms | tokens {a.prompt_tokens}/{a.completion_tokens} | "
              f"trace: python -m assistant.trace_view {a.trace_id}\n")
        history += [{"role": "user", "content": q}, {"role": "assistant", "content": a.answer}]


if __name__ == "__main__":
    main()
