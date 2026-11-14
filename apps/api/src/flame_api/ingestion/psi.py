"""Import public PSI metadata; this command does not download publication full texts."""
import argparse
import hashlib
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ..config import REPOSITORY_ROOT
from ..models import Catalog, Investigation, Publication, PublicationLink

BASE_URL = "https://psi.nasa.gov"
FAMILIES = ("ACME", "FLEX", "BASS", "SAFFIRE", "SAME", "SPICE", "CFI", "SLICE", "DAFT")


def normalize_doi(value: str | None) -> str | None:
    value = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", (value or "").strip(), flags=re.I)
    return value.casefold() if re.fullmatch(r"10\.\d{4,9}/\S+", value) else None


def normalize_documents(documents: list[dict], query: str, retrieved_at: datetime) -> Catalog:
    investigations, publications, links = [], {}, []
    for document in documents:
        accession = document["accession"]
        acronym = document.get("investigationAcronym") or None
        family = next((f for f in FAMILIES if acronym and re.match(rf"^{f}(?:\b|[-/])", acronym, re.I)), None)
        investigations.append(Investigation(
            id=accession, title=document["title"], acronym=acronym, family=family,
            family_basis="PSI investigation acronym" if family else None,
            research_area=document.get("researchArea"), project_type=document.get("projectType"),
            objective=document.get("objective") or "", approach=document.get("approach") or "",
            hardware=document.get("experimentHardware") or None,
            related_ids=[x.strip() for x in (document.get("related_glds") or "").split(",") if x.strip()],
            dataset_doi=normalize_doi(document.get("doi")),
            source_url=f"{BASE_URL}/physci/repo/data/investigations/{accession}",
        ))
        for entry, publication in enumerate(document.get("publications", []), 1):
            title = publication.get("title", "").strip()
            if not title:
                raise ValueError(f"Missing publication title: {accession}, entry {entry}")
            doi = normalize_doi(publication.get("doi"))
            # A conference paper and a journal paper can share a title. Without a
            # DOI, preserve separate source records until a curator confirms a match.
            identity = f"doi:{doi}" if doi else f"source:{accession}:{entry}:{title}"
            pub_id = "PUB-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
            if pub_id not in publications:
                publications[pub_id] = Publication(
                    id=pub_id, title=title, authors=publication.get("authorList") or "", doi=doi,
                )
            links.append(PublicationLink(
                investigation_id=accession, publication_id=pub_id, source_entry=entry,
                title_at_source=title, doi_at_source=publication.get("doi") or None,
            ))
    return Catalog(
        query=query, retrieved_at=retrieved_at, investigations=investigations,
        publications=list(publications.values()), links=links,
    )


def get_json(url: str) -> dict:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "FlameAtlas/0.1 (public PSI metadata)"})
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.load(response)
            if not isinstance(result, dict) or result.get("message") == "Internal Server Error":
                raise ValueError("Invalid PSI response")
            return result
        except (urllib.error.URLError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError("Unreachable request state")


def search_investigations(query: str) -> list[dict]:
    results, seen, total = [], set(), None
    while total is None or len(results) < total:
        params = urllib.parse.urlencode({
            "term": query, "source": "psi", "type": "investigation", "from": len(results), "size": 100,
        })
        response = get_json(f"{BASE_URL}/geode-py/ws/repo/search?{params}")
        if response.get("timed_out") or response.get("_shards", {}).get("failed", 0):
            raise ValueError("PSI returned an incomplete search")
        total = response["hits"]["total"]
        if isinstance(total, dict):
            total = total["value"]
        hits = response["hits"]["hits"]
        if not hits and len(results) < total:
            raise ValueError("PSI pagination stopped before the reported total")
        for hit in hits:
            accession = hit["_source"]["Accession"]
            if accession in seen:
                raise ValueError("Repeated investigation during PSI pagination")
            seen.add(accession)
            results.append(hit)
    if len(results) != total:
        raise ValueError("PSI search total does not match fetched records")
    return results


def write_catalog(catalog: Catalog, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(catalog.model_dump_json(indent=2))
            stream.write("\n")
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", default="combustion")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--accession", action="append", help="Fetch a specific PSI ID; repeat for multiple IDs")
    source.add_argument("--input-dir", type=Path, help="Normalize previously downloaded PSI-*.json files offline")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "data/processed/catalog.json")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    if args.input_dir:
        files = sorted(p for p in args.input_dir.glob("PSI-*.json") if re.fullmatch(r"PSI-\d+", p.stem))
        if not files:
            parser.error("No PSI-*.json files were found in --input-dir")
        documents = [json.loads(p.read_text(encoding="utf-8")) for p in files]
    else:
        run_dir = REPOSITORY_ROOT / "data/raw" / now.strftime("%Y%m%dT%H%M%S%fZ")
        excluded, search_hits = [], []
        if args.accession:
            accessions = list(dict.fromkeys(args.accession))
        else:
            search_hits = search_investigations(args.query)
            accessions = [h["_source"]["Accession"] for h in search_hits if h["_source"].get("Research Area") == "Combustion Science"]
            excluded = [h["_source"]["Accession"] for h in search_hits if h["_source"].get("Research Area") != "Combustion Science"]
        if any(not re.fullmatch(r"PSI-\d+", accession) for accession in accessions):
            parser.error("Accession must have the form PSI-117")
        if not accessions:
            parser.error("No Combustion Science investigations matched; existing catalog was kept")
        run_dir.mkdir(parents=True, exist_ok=False)
        documents, manifest_files = [], []
        for accession in accessions:
            url = f"{BASE_URL}/geode-py/ws/repo/investigations/{accession}"
            document = get_json(url)
            if document.get("accession") != accession or document.get("public") is not True:
                raise ValueError(f"Unexpected or non-public PSI response for {accession}")
            content = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
            (run_dir / f"{accession}.json").write_bytes(content)
            manifest_files.append({"accession": accession, "url": url, "sha256": hashlib.sha256(content).hexdigest()})
            documents.append(document)
        manifest = {"retrieved_at": now.isoformat(), "query": args.query,
                    "search_results": search_hits, "excluded_ids": excluded, "files": manifest_files}
        (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    catalog = normalize_documents(documents, args.query, now)
    write_catalog(catalog, args.output)
    print(json.dumps({"investigations": len(catalog.investigations),
                      "publications": len(catalog.publications), "links": len(catalog.links),
                      "catalog": str(args.output)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
