"""Three independent RAG evaluation criteria (free, no LLM calls).

  1. Faithfulness          – is each sentence derivable from the retrieved context (any source)?
  2. Citation correctness  – does the source a sentence is tagged with actually support it?
  3. Answer correctness    – does the answer contain the gold facts from the original NASA documents
                             (eval/questions.jsonl "reference_facts", each tied to a source chunk)?

1 and 2 come from assistant/verify.py. 3 is a keyword check against hand-written gold facts:
a fact counts as covered when every keyword group (regex alternatives "a|b") appears in the answer.
It measures recall of key facts only; it cannot detect a wrong statement that the gold set does not
cover, so sentences flagged by 1/2 or as inferences still need human review.
"""
from __future__ import annotations

import json
import re
from typing import Any

from .agent import Assistant, EvidenceRegistry
from .verify import verify_answer


def rebuild_evidence(bot: Assistant, tool_calls: list[dict]) -> EvidenceRegistry:
    """Replay the recorded tool calls offline to rebuild the exact evidence the model saw (same tags).
    Only valid while the corpus and retriever are unchanged since the answer was produced."""
    reg = EvidenceRegistry()
    for t in tool_calls:
        args = t.get("args") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                continue
        name = t.get("name", "")
        try:
            if name.startswith("search_documents"):
                bot._tool_search_documents(reg, None, "replay", **args)
            elif name == "search_investigations":
                bot._tool_search_investigations(reg, **args)
            elif name == "compare_investigations":
                bot._tool_compare(reg, **args)
            elif name == "predict_flammability":
                bot._tool_predict(reg, **args)
        except TypeError:
            continue
    return reg


def pin_saved_citations(bot: Assistant, reg: EvidenceRegistry, citations: list[dict]) -> int:
    """Make cited tags point at the chunks the model actually saw. Saved citations carry `evidence`
    (full text, new runs) or a 300-char `snippet` (old runs) that is matched back to its corpus chunk.
    Needed because a replay after a retriever change can assign tags to different chunks.
    Returns how many tags were corrected."""
    by_prefix = {c.text[:120]: c for c in bot.retriever.chunks}
    fixed = 0
    for c in citations or []:
        ref = c.get("ref")
        if not ref:
            continue
        full = c.get("evidence")
        if not full and c.get("kind") == "document":
            ch = by_prefix.get((c.get("snippet") or "")[:120])
            full = f"{ch.title}\n{ch.section}\n{ch.text}" if ch else None
        if full and reg.texts.get(ref) != full:
            if ref in reg.texts:
                reg.texts[f"_replay_{ref}"] = reg.texts[ref]  # keep the replayed chunk in the context pool
            reg.texts[ref] = full
            fixed += 1
    return fixed


def score_facts(answer: str, facts: list[dict]) -> dict:
    text = answer.lower()
    rows = []
    for f in facts:
        missing = [k for k in f["keywords"] if not re.search(k, text)]
        rows.append({"fact": f["fact"], "source": f.get("source", ""), "covered": not missing, "missing": missing})
    covered = sum(r["covered"] for r in rows)
    return {"covered": covered, "total": len(rows), "score": round(covered / len(rows), 2) if rows else None,
            "facts": rows}


def evaluate(answer: str, refused: bool, evidence: dict[str, str], facts: list[dict] | None) -> dict[str, Any]:
    v = verify_answer(answer, evidence) if not refused else verify_answer("", {})
    return {
        "faithfulness": v["faithfulness"]["score"],
        "citation_correctness": v["citation_correctness"],
        "answer_correctness": score_facts(answer, facts)["score"] if facts and not refused else None,
        "facts": score_facts(answer, facts) if facts else None,
        "claims": v["claims"], "unfaithful": v["faithfulness"]["unsupported"], "miscited": v["miscited"],
        "inference": v["inference"],
        "review": [{k: x[k] for k in ("text", "refs", "status", "context_status", "suggested_refs", "inference")}
                   for x in v["sentences"]
                   if x["status"] != "supported" or x["context_status"] != "supported" or x["inference"]],
    }
