"""Run the evaluation set against the assistant.

  python eval/run_eval.py                 # uses DeepSeek if a key is set -> COSTS QUOTA (~$0.03 for 17 questions)
  python eval/run_eval.py --offline       # free, BM25 only (checks retrieval + refusals)
  python eval/run_eval.py --estimate      # free, only prints the estimated cost, no calls
  python eval/run_eval.py path/to/questions.jsonl
  python eval/run_eval.py --rescore eval/results_v2_deepseek.jsonl   # free: re-score saved answers

Checks per question:
  behavior  – answered vs refused matches "expect" ("partial" = answered with a Limitations line; counts as answer)
  sources   – at least one citation's source_id starts with one of "expect_sources" (if given)
Three RAG criteria (assistant/evaluate.py, all free):
  faithfulness          share of claims derivable from ANY retrieved context
  citation correctness  share of cited claims supported by the sources they are tagged with
  answer correctness    share of gold "reference_facts" (from the original NASA documents) covered
Detailed results go to eval/results.jsonl (DeepSeek), eval/results_offline.jsonl, or <file>.rescored.jsonl. Sentences listed under
"review" (unsupported, mis-cited or inference/generalization) must still be read by a human.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.agent import Assistant  # noqa: E402
from assistant.evaluate import evaluate, pin_saved_citations, rebuild_evidence, score_facts  # noqa: E402


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return f"{sum(xs) / len(xs):.2f} (n={len(xs)})" if xs else "-"


def _print_criteria(rows: list[dict]) -> None:
    print("\nRAG criteria (mean over answered questions):")
    print(f"  faithfulness         {_avg([r['faithfulness'] for r in rows])}")
    print(f"  citation correctness {_avg([r['citation_correctness'] for r in rows])}")
    print(f"  answer correctness   {_avg([r['answer_correctness'] for r in rows])}  (gold-fact recall)")
    print(f"  unfaithful claims {sum(r['unfaithful'] for r in rows)} | mis-cited {sum(r['miscited'] for r in rows)} | "
          f"inference/generalization {sum(r['inference'] for r in rows)}  -> see 'review' in the results file")


def rescore(path: Path, questions: dict) -> None:
    """Re-score saved answers without any LLM call: replay retrieval to rebuild evidence, then evaluate."""
    bot = Assistant(offline=True)
    rows, out_path = [], path.with_suffix(".rescored.jsonl")
    with open(out_path, "w", encoding="utf-8") as out:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            facts = questions.get(r.get("id"), {}).get("reference_facts") or r.get("reference_facts")
            reg = rebuild_evidence(bot, r.get("tool_calls", []))
            pin_saved_citations(bot, reg, r.get("citations", []))
            ev = evaluate(r["answer"], r.get("refused", False), reg.texts, facts)
            if not r.get("refused"):
                rows.append(ev)
            f = ev["facts"]
            fs = f"{f['covered']}/{f['total']}" if f else "-"
            print(f"{r.get('id', '?'):<4} {'refused' if r.get('refused') else 'answer':<8} "
                  f"faith={ev['faithfulness'] if ev['faithfulness'] is not None else '-':<5} "
                  f"cite={ev['citation_correctness'] if ev['citation_correctness'] is not None else '-':<5} "
                  f"facts={fs:<5} review={len(ev['review'])}")
            out.write(json.dumps({"id": r.get("id"), "question": r.get("question"), **ev}, ensure_ascii=False) + "\n")
    _print_criteria(rows)
    print(f"Details: {out_path}  (evidence rebuilt by replaying retrieval; valid while the corpus is unchanged)")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    qfile = Path(args[0]) if args else Path(__file__).parent / "questions.jsonl"
    if "--rescore" in sys.argv:
        qs = Path(__file__).parent / "questions.jsonl"
        qmap = {q["id"]: q for q in (json.loads(l) for l in qs.read_text(encoding="utf-8").splitlines() if l.strip())}
        rescore(Path(args[0]) if args else Path(__file__).parent / "results.jsonl", qmap)
        return
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
    # offline runs never overwrite the (paid) DeepSeek results
    out_path = Path(__file__).parent / ("results_offline.jsonl" if bot.offline else "results.jsonl")
    stats = defaultdict(lambda: [0, 0])
    crit_rows = []
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
            v = a.verification or {}
            facts = score_facts(a.answer, q["reference_facts"]) if q.get("reference_facts") else None
            crit = {"faithfulness": (v.get("faithfulness") or {}).get("score"),
                    "citation_correctness": v.get("citation_correctness"),
                    "answer_correctness": facts["score"] if facts and not a.refused else None,
                    "unfaithful": (v.get("faithfulness") or {}).get("unsupported", 0),
                    "miscited": v.get("miscited", 0), "inference": v.get("inference", 0)}
            if not a.refused:
                crit_rows.append(crit)
            fs = f"{facts['covered']}/{facts['total']}" if facts else "-"
            searches = sum(1 for t in a.tool_calls if t["name"] == "search_documents")
            partial = (not a.refused) and "limitation" in a.answer.lower()
            print(f"{'PASS' if ok else 'FAIL'} {q['id']} {q.get('category', ''):<10} expect={q['expect']:<6} "
                  f"got={got:<6}{'(partial)' if partial else '':<9} sources={src:<4} cites={len(a.citations):<2} "
                  f"searches={searches} facts={fs:<4} "
                  f"${a.cost_usd:.4f} | {q['question'][:45]}")
            out.write(json.dumps({**q, "got": got, "partial": partial, "searches": searches,
                                  "behavior_ok": behavior_ok, "source_ok": source_ok, "ok": ok,
                                  "criteria": crit, "facts": facts,
                                  **a.to_dict()}, ensure_ascii=False, default=str) + "\n")
    print(f"\n{passed}/{len(questions)} passed | " +
          " | ".join(f"{k} {v[0]}/{v[1]}" for k, v in stats.items()) +
          f"\nTotal cost ${total_cost:.4f} | details: {out_path}")
    _print_criteria(crit_rows)


if __name__ == "__main__":
    main()
