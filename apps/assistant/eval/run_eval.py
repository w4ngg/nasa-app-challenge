"""Chạy bộ câu hỏi kiểm thử với DeepSeek thật để rà câu trả lời sai/bịa.

python eval/run_eval.py [eval/questions.jsonl]
Ghi kết quả chi tiết vào eval/results.jsonl để cả nhóm đọc lại.

Kỳ vọng "answer"/"refuse" viết cho dữ liệu thật (scripts/fetch_sources.py + assistant.ingest).
q10: PSI chưa có dữ liệu trọng lực một phần; q11: tên lửa nằm ngoài phạm vi đề bài.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.agent import Assistant  # noqa: E402


def main() -> None:
    qfile = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "questions.jsonl"
    questions = [json.loads(l) for l in qfile.read_text(encoding="utf-8").splitlines() if l.strip()]
    bot = Assistant()
    out_path = Path(__file__).parent / "results.jsonl"
    passed, total_cost = 0, 0.0
    with open(out_path, "w", encoding="utf-8") as out:
        for q in questions:
            a = bot.ask(q["question"])
            got = "refuse" if a.refused else "answer"
            ok = got == q["expect"] and (a.refused or len(a.citations) > 0)
            passed += ok
            total_cost += a.cost_usd
            print(f"{'PASS' if ok else 'FAIL'} {q['id']} expect={q['expect']:<6} got={got:<6} "
                  f"cites={len(a.citations)} ${a.cost_usd:.4f} | {q['question'][:60]}")
            out.write(json.dumps({**q, "got": got, "ok": ok, **a.to_dict()}, ensure_ascii=False, default=str) + "\n")
    print(f"\n{passed}/{len(questions)} pass | tổng chi phí ${total_cost:.4f} | chi tiết: {out_path}")
    print("Nhớ đọc tay từng câu 'answer': trích dẫn có thật sự ủng hộ câu đó không?")


if __name__ == "__main__":
    main()
