"""So sánh bộ truy xuất BM25 / dense / hybrid (miễn phí, không gọi LLM).

  python eval/retrieval_eval.py                       # k = 5 và 10
  python eval/retrieval_eval.py --runs eval/results_v4_deepseek.jsonl

Gold = các chunk mà reference_facts trong eval/questions.jsonl trỏ tới (vd "PSI-102#2"); fact gắn với
"SCENARIO:..." (đề bài) bị bỏ qua vì không nằm trong corpus.

Hai bộ truy vấn:
  question  câu hỏi gốc (giống bước prefetch và chế độ offline)
  llm       đúng các truy vấn search_documents mà DeepSeek đã gửi trong file kết quả đã lưu (--runs);
            gộp kết quả mọi truy vấn của một câu hỏi rồi so với gold của câu đó
Chỉ số:
  recall@k  tỉ lệ chunk gold nằm trong top-k
  source@k  tỉ lệ nguồn gold (PSI-102, NTRS-...) có ít nhất một chunk trong top-k
  MRR       1 / hạng của chunk gold đầu tiên (0 nếu không có trong top-k)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from assistant.retriever import DocumentRetriever  # noqa: E402


def gold_chunks(q: dict) -> set[str]:
    return {f["source"] for f in q.get("reference_facts") or [] if f.get("source") and "#" in f["source"]
            and not f["source"].startswith("SCENARIO:")}


def llm_queries(runs: Path | None) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not runs or not runs.exists():
        return out
    for line in runs.read_text(encoding="utf-8").split("\n"):
        if not line.strip():
            continue
        r = json.loads(line)
        for t in r.get("tool_calls") or []:
            if not str(t.get("name", "")).startswith("search_documents"):
                continue
            args = t.get("args") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    continue
            if args.get("query"):
                out.setdefault(r["id"], []).append(args["query"])
    return out


def score(hit_ids: list[str], gold: set[str]) -> tuple[float, float, float]:
    rec = len(gold & set(hit_ids)) / len(gold)
    gsrc = {g.split("#")[0] for g in gold}
    src = len(gsrc & {h.split("#")[0] for h in hit_ids}) / len(gsrc)
    mrr = next((1 / r for r, h in enumerate(hit_ids, 1) if h in gold), 0.0)
    return rec, src, mrr


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, nargs="+", default=[5, 10])
    ap.add_argument("--runs", type=Path, default=ROOT / "eval" / "results_v4_deepseek.jsonl")
    ap.add_argument("--show", action="store_true", help="in từng câu hỏi")
    args = ap.parse_args()

    qs = [json.loads(x) for x in (ROOT / "eval" / "questions.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    qs = [q for q in qs if gold_chunks(q)]
    lq = llm_queries(args.runs)
    r = DocumentRetriever(mode="hybrid")
    modes = ["bm25", "dense", "hybrid"] if r.dense is not None else ["bm25"]
    if r.dense is None:
        print("sentence-transformers / model unavailable: only BM25 is measured")
    print(f"{len(qs)} questions with gold chunks; {sum(1 for q in qs if q['id'] in lq)} have saved DeepSeek queries "
          f"({args.runs.name})\n")

    rows = {}
    for qset in ("question", "llm"):
        for k in args.k:
            for m in modes:
                acc, n, t0, nq = [0.0, 0.0, 0.0], 0, time.perf_counter(), 0
                per = []
                for q in qs:
                    queries = [q["question"]] if qset == "question" else lq.get(q["id"], [])
                    if not queries:
                        continue
                    ids: list[str] = []
                    for text in queries:
                        nq += 1
                        for c, _ in r.search(text, k=k, mode=m):
                            if c.id not in ids:
                                ids.append(c.id)
                    s = score(ids, gold_chunks(q))
                    per.append((q["id"], s))
                    acc = [a + b for a, b in zip(acc, s)]
                    n += 1
                if not n:
                    continue
                ms = (time.perf_counter() - t0) * 1000 / max(nq, 1)
                rows[(qset, k, m)] = per
                print(f"{qset:8s} k={k:<2d} {m:6s}  recall {acc[0]/n:.3f}  source {acc[1]/n:.3f}  MRR {acc[2]/n:.3f}"
                      f"   ({n} q, {ms:.0f} ms/query)")
            print()

    if args.show:
        k = args.k[0]
        for qset in ("question", "llm"):
            if (qset, k, "bm25") not in rows:
                continue
            print(f"per question, {qset}, recall@{k}:  " + "  ".join(modes))
            for i, (qid, s) in enumerate(rows[(qset, k, "bm25")]):
                vals = [rows[(qset, k, m)][i][1][0] for m in modes]
                mark = " <-" if len(set(vals)) > 1 else ""
                print(f"  {qid:4s} " + "  ".join(f"{v:.2f}" for v in vals) + mark)


if __name__ == "__main__":
    main()
