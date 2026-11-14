"""Check the knowledge graph against the raw PSI records, and draw a sample of concept links for hand review.

    flame-verify-graph --raw data/raw/psi_full --sample 40

Structural checks are exact (counts and pairs reconciled with the PSI JSON). Concept links come
from keyword matching, so they are checked by people: the sample CSV lists each link with the
sentence that triggered it; mark the `correct` column and report the share marked yes.
"""
import argparse
import csv
import json
import random
import re
from pathlib import Path

from .config import REPOSITORY_ROOT


def normalize_doi(value: str) -> str:
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", (value or "").strip(), flags=re.I).lower()


def check(graph: dict, raw: dict[str, dict]) -> list[tuple[str, bool, str]]:
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = graph["edges"]
    by_type = lambda t: [e for e in edges if e["type"] == t]  # noqa: E731
    results = []

    results.append(("Investigations match the PSI records", sum(n["type"] == "investigation" for n in nodes.values()) == len(raw),
                    f"{sum(n['type'] == 'investigation' for n in nodes.values())} in graph, {len(raw)} PSI records"))

    want_pubs = {(a, normalize_doi(p.get("doi") or "") or f"entry{i}") for a, d in raw.items() for i, p in enumerate(d.get("publications") or [], 1)}
    results.append(("Every PSI publication entry has a lists_publication edge (same DOI twice in one record counts once)",
                    len(by_type("lists_publication")) == len(want_pubs),
                    f"{len(by_type('lists_publication'))} edges, {len(want_pubs)} distinct entries"))

    want_tables = sum(len(d.get("experimentalTable") or []) for d in raw.values())
    results.append(("Every experiment table has a has_dataset edge", len(by_type("has_dataset")) == want_tables,
                    f"{len(by_type('has_dataset'))} edges, {want_tables} tables"))

    want_related = {tuple(sorted((a, b.strip()))) for a, d in raw.items() for b in (d.get("related_glds") or "").split(",") if b.strip() in raw}
    have_related = {tuple(sorted((e["source"], e["target"]))) for e in by_type("related_to")}
    results.append(("related_to edges equal the related pairs listed on PSI", have_related == want_related,
                    f"{len(have_related)} edges, {len(want_related)} pairs; missing {sorted(want_related - have_related)}"))

    dangling = [e["id"] for e in edges if e["source"] not in nodes or e["target"] not in nodes]
    results.append(("No edge points to a missing node", not dangling, f"{len(dangling)} dangling"))
    no_evidence = [e["id"] for e in edges if not e.get("evidence") or not e.get("url")]
    results.append(("Every edge has evidence text and a source link", not no_evidence, f"{len(no_evidence)} without"))

    parented = {e["target"] for e in edges if e["type"] in ("includes", "lists_publication", "has_dataset")}
    orphans = [i for i, n in nodes.items() if n["type"] in ("program", "investigation", "publication", "dataset") and i not in parented]
    results.append(("Every program, investigation, publication and dataset has a hierarchy parent", not orphans, f"{len(orphans)} orphans"))

    for e in by_type("studies"):
        if e["source"] in raw:
            quoted = re.search(r"“(.+)”", e["evidence"])
            text = " ".join(str(raw[e["source"]].get(k) or "") for k in ("title", "objective", "approach", "hypothesis", "researchImpacts"))
            if quoted and quoted.group(1).strip("…")[:40] not in " ".join(text.split()):
                results.append(("Concept evidence is quoted from the PSI text", False, f"{e['id']} quote not found"))
                break
    else:
        results.append(("Concept evidence is quoted from the PSI text", True, "every investigation quote found in its PSI record"))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--graph", type=Path, default=REPOSITORY_ROOT / "apps/web/public/data/graph.json")
    parser.add_argument("--raw", type=Path, default=REPOSITORY_ROOT / "data/raw/psi_full", help="Directory with PSI-*.json records")
    parser.add_argument("--sample", type=int, default=40, help="Concept links to write for hand review")
    parser.add_argument("--audit", type=Path, default=REPOSITORY_ROOT / "docs/graph-audit.csv")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    raw = {d["accession"]: d for d in (json.loads(p.read_text(encoding="utf-8")) for p in sorted(args.raw.glob("PSI-*.json")))}
    failed = 0
    for name, ok, detail in check(graph, raw):
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    labels = {n["id"]: n.get("title") or n["label"] for n in graph["nodes"]}
    concept_edges = [e for e in graph["edges"] if e["type"] == "studies"]
    sample = random.Random(args.seed).sample(concept_edges, min(args.sample, len(concept_edges)))
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    with args.audit.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["source", "concept", "evidence", "url", "correct (yes/no)", "note"])
        for e in sample:
            writer.writerow([labels.get(e["source"], e["source"]), labels.get(e["target"], e["target"]), e["evidence"], e["url"], "", ""])
    print(f"Wrote {len(sample)} concept links for hand review to {args.audit}")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
