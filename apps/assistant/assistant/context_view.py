"""Xem context sẽ gửi cho DeepSeek và ước lượng chi phí – KHÔNG gọi LLM, không tốn tiền.

  python -m assistant.context_view "What suppressants did FLEX test?"
  python -m assistant.context_view "..." --full     # in toàn bộ messages
  python -m assistant.context_view "..." --json

Trong chat CLI: gõ  /context <câu hỏi>  (dùng cả lịch sử hội thoại hiện tại).
"""
from __future__ import annotations

import json
import sys


def render(p: dict, full: bool = False) -> str:
    out = [f"Câu hỏi: {p['question']}",
           f"Mode: {p['mode']} | model {p['model']} | giá ${p['price_per_m']['input']}/"
           f"${p['price_per_m']['output']} mỗi 1M token (input/output)",
           f"Ước lượng token: {p['estimation']}", "",
           f"{'Thành phần context (lượt gọi đầu)':<40}{'ký tự':>9}{'~token':>9}"]
    for part in p["parts"]:
        out.append(f"  {part['part']:<38}{part['chars']:>9,}{part['tokens']:>9,}")
    out.append(f"  {'TỔNG input lượt đầu (kèm overhead)':<38}{'':>9}{p['first_call_input_tokens']:>9,}")
    h = p["history"]
    out.append(f"\nLịch sử: {h['history_in']} tin -> giữ {h['kept']}, tóm tắt {h['summarized']} "
               f"({h['method']}{', request thật sẽ gọi LLM tóm tắt' if h.get('needs_llm_summary') else ''})")
    hits = ", ".join(f"{x['tag']} {x['source_id']} ({x['score']})" for x in p["prefetch_hits"]) or "không có"
    out.append(f"Prefetch: {hits}")
    out.append(f"\n{'Kịch bản':<10}{'vòng tool':>10}{'lượt LLM':>10}{'~in':>9}{'~out':>8}{'~USD':>11}")
    labels = {"direct": "trả lời ngay", "typical": "1 lần search", "worst": "tối đa vòng"}
    for s in p["scenarios"]:
        out.append(f"{s['scenario']:<10}{s['tool_rounds']:>10}{s['llm_calls']:>10}{s['input_tokens']:>9,}"
                   f"{s['output_tokens']:>8,}{s['cost_usd']:>11.5f}   {labels[s['scenario']]}")
    b = p["budget"]
    out.append(f"\nNgân sách: đã dùng ${b['spent_usd']} / ${b['limit_usd']} -> còn ${b['remaining_usd']} "
               f"(~{b['questions_left_typical']} câu hỏi kiểu 'typical')")
    if full:
        out.append("\n===== MESSAGES =====")
        for i, m in enumerate(p["messages"]):
            out.append(f"\n--- [{i}] {m['role']} ({len(str(m['content'])):,} ký tự)\n{m['content']}")
    return "\n".join(out)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return
    from .agent import preview_context
    p = preview_context(" ".join(args))
    if "--json" in sys.argv:
        print(json.dumps(p, indent=2, ensure_ascii=False))
    else:
        print(render(p, full="--full" in sys.argv))


if __name__ == "__main__":
    main()
