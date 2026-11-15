"""Apply review records without altering scientific claims or publishing findings."""
import argparse
import copy
import hashlib
import json
from pathlib import Path


def apply_review(input_path, review_path, output_path):
    raw = input_path.read_bytes()
    review_raw = review_path.read_bytes()
    review = json.loads(review_raw)
    if review.get("schema_version") != "review-v1":
        raise ValueError("Unsupported review schema")
    if review.get("input_sha256") != hashlib.sha256(raw).hexdigest():
        raise ValueError("Review does not match this exact findings file")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        raise ValueError("Reviewer is required")
    if not isinstance(review.get("reviewed_at"), str) or not review["reviewed_at"]:
        raise ValueError("Review timestamp is required")
    result = copy.deepcopy(json.loads(raw))
    candidates = result["candidates"]
    index = {c["id"]: c for c in candidates}
    if len(index) != len(candidates):
        raise ValueError("Duplicate finding IDs")
    seen = set()
    decisions = review.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("Expected decisions list")
    for decision in decisions:
        identifier = decision["finding_id"]
        if identifier not in index or identifier in seen:
            raise ValueError("Unknown or duplicate review ID")
        seen.add(identifier)
        candidate = index[identifier]
        if decision.get("source_sha256") != candidate["source"]["source_sha256"]:
            raise ValueError("Source hash mismatch")
        status = decision.get("decision")
        if status not in {"pending", "revise", "reject", "accept_for_demo"}:
            raise ValueError("Unknown decision")
        notes = decision.get("notes", "")
        if not isinstance(notes, str):
            raise ValueError("Review notes must be text")
        if status != "pending" and (not notes.strip() or decision.get("source_checked") is not True):
            raise ValueError("A decision requires notes and source confirmation")
        event = {"reviewer": review["reviewer"], "reviewed_at": review["reviewed_at"],
                 "decision": status, "notes": notes,
                 "source_checked": decision.get("source_checked") is True,
                 "review_file_sha256": hashlib.sha256(review_raw).hexdigest()}
        candidate.setdefault("review_history", []).append(event)
        candidate["review_decision"] = status
        candidate["review_notes"] = notes
        candidate["status"] = {"pending": "pending_review", "revise": "needs_revision",
                               "reject": "rejected_by_reviewer",
                               "accept_for_demo": "demo_accepted_pending_export"}[status]
        # Review acceptance does not automatically establish scientific validity
        # or satisfy a public export contract. Existing flags remain intact.
        candidate["scientifically_verified"] = False
        candidate["approved_for_publication"] = False
        candidate["review_required"] = status in {"pending", "revise"}
    result["status"] = "review_recorded_not_published"
    result["review_input_sha256"] = hashlib.sha256(raw).hexdigest()
    result["review_file_sha256"] = hashlib.sha256(review_raw).hexdigest()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"Recorded {len(seen)} reviews. No source claims changed. No publication.")
    print(output_path)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    apply_review(args.input, args.review, args.out)
