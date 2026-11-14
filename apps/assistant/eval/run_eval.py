"""Run the evaluation set against the assistant.

  python eval/run_eval.py                 # uses DeepSeek if a key is set -> COSTS QUOTA (~$0.03 for 17 questions)
  python eval/run_eval.py --offline       # free, BM25 only (checks retrieval + refusals)
  python eval/run_eval.py --estimate      # free, only prints the estimated cost, no calls
  python eval/run_eval.py path/to/questions.jsonl

Checks per question:
  behavior  – answered vs refused matches "expect"
  sources   – at least one citation's source_id starts with one of "expect_sources" (if given)
Detailed results are written to eval/results.jsonl. Always read the "answer" items by hand:
does each cited passage really support the sentence it is attached to?
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.agent import Assistant  # noqa: E402


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    qfile = Path(args[0]) if args else Path(__file__).parent / "questions.jsonl"
    questions = [json.loads(l) for l in qfile.read_text(encoding="utf-8").splitlines() if l.strip()]
    bot = Assistant(offline=True if ("--offline" in sys.argv or "--estimate" in sys.argv) else None)

    if "--estimate" in sys.argv:
        tot = defaultdict(float)
        for q in questions:
            for s in bot.preview_context(q["question"])["scenarios"]:
                tot[s["scenario"]] += s["cost_usd"]
        print(f"{len(questions)} questions, estimated DeepSeek cost: direct ${tot['direct']:.3f} | "
              f"typical ${tot['typical']:.3f} | worst ${tot['worst']:.3f}  (no API calls made)")
        return

    print(f"Mode: {'OFFLINE (free)' if bot.offline else 'DeepSeek (paid)'} | {len(questions)} questions\n")
    out_path = Path(__file__).parent / "results.jsonl"
    stats = defaultdict(lambda: [0, 0])
    total_cost, passed = 0.0, 0
    with open(out_path, "w", encoding="utf-8") as out:
        for q in questions:
            a = bot.ask(q["question"])
            got = "refuse" if a.refused else "answer"
            behavior_ok = got == q["expect"]
            exp = q.get("expect_sources")
            source_ok = None
            if exp and not a.refused:
                source_ok = any(c.source_id.startswith(p) for c in a.citations for p in exp)
            ok = behavior_ok and source_ok is not False
            passed += ok
            total_cost += a.cost_usd
            stats[q.get("category", "-")][0] += ok
            stats[q.get("category", "-")][1] += 1
            src = "-" if source_ok is None else ("ok" if source_ok else "MISS")
            print(f"{'PASS' if ok else 'FAIL'} {q['id']} {q.get('category', ''):<10} expect={q['expect']:<6} "
                  f"got={got:<6} sources={src:<4} cites={len(a.citations)} ${a.cost_usd:.4f} | {q['question'][:55]}")
            out.write(json.dumps({**q, "got": got, "behavior_ok": behavior_ok, "source_ok": source_ok, "ok": ok,
                                  **a.to_dict()}, ensure_ascii=False, default=str) + "\n")
    print(f"\n{passed}/{len(questions)} passed | " +
          " | ".join(f"{k} {v[0]}/{v[1]}" for k, v in stats.items()) +
          f"\nTotal cost ${total_cost:.4f} | details: {out_path}")
    print("Read the answered items by hand: does each citation really support its sentence?")


if __name__ == "__main__":
    main()
