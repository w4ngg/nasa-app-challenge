"""Inventory the current public file trees for every PSI combustion search hit.

Downloads JSON metadata and listings only; scientific file contents are not fetched.
Run with the repository virtual environment after installing apps/api.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from flame_api.config import REPOSITORY_ROOT
from flame_api.ingestion.psi import BASE_URL, get_json, search_investigations


def file_listing(accession, version):
    payload = {"folder": accession + "/", "fileType": "study", "studyId": accession, "version": version}
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                BASE_URL + "/geode-py/ws/files/v2", data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "FlameAtlas-file-inventory/0.1"},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.load(response)
            if not isinstance(result.get("files"), list):
                raise ValueError("Unexpected file listing response for " + accession)
            return result, payload
        except (urllib.error.URLError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def flatten_tree(tree, accession, investigation_version):
    files, folders, seen, duplicate_references = [], [], {}, 0

    def visit(nodes, display_parents):
        nonlocal duplicate_references
        for node in nodes:
            key = node.get("key") or node.get("fullPath") or ""
            directory = bool(node.get("directory")) or key.endswith("/")
            name = node.get("displayName") or PurePosixPath(key.rstrip("/")).name
            display_path = display_parents + [name]
            if directory:
                folders.append({"storage_key": key, "display_path": "/".join(display_path),
                                "visible": node.get("visible", True)})
                visit(node.get("files", []), display_path)
            else:
                if node.get("files"):
                    raise ValueError("File node unexpectedly contains children: " + key)
                identity = (str(node.get("id") or key), node.get("version"))
                if identity in seen:
                    previous = seen[identity]
                    if previous["storage_key"] != key or previous["bytes"] != node.get("bytes_size"):
                        raise ValueError("Conflicting metadata for repeated file identity: " + key)
                    previous["reference_count"] += 1
                    if "/".join(display_path) not in previous["display_paths"]:
                        previous["display_paths"].append("/".join(display_path))
                    duplicate_references += 1
                    continue
                extension = ".".join(PurePosixPath(name).suffixes[-2:]).replace("..", ".") if name.lower().endswith((".tar.gz", ".tar.bz2", ".tar.xz")) else PurePosixPath(name).suffix.lower()
                files.append({
                    "investigation_id": accession, "investigation_version": investigation_version,
                    "file_id": node.get("id"), "file_version": node.get("version"),
                    "name": name, "storage_key": key, "display_path": "/".join(display_path),
                    "category": node.get("sortingCategory") or (display_path[0] if display_path else ""),
                    "subcategory": node.get("subcategory"), "extension": extension or "[no extension]",
                    "bytes": node.get("bytes_size"), "display_size": node.get("size"),
                    "status": node.get("status"), "visible": node.get("visible", True),
                    "restricted": node.get("restricted", False), "restricted_access": node.get("restrictedAccess", False),
                    "updated_source": node.get("updated"), "reference_count": 1,
                    "display_paths": ["/".join(display_path)],
                })
                seen[identity] = files[-1]

    visit(tree["files"], [])
    return files, folders, duplicate_references


def summarize(metadata, listing):
    accession, version = metadata["accession"], metadata["version"]
    files, folders, duplicates = flatten_tree(listing, accession, version)
    visible = [f for f in files if f["visible"] and f["status"] in (None, "active")]
    category_stats = {}
    for category in dict.fromkeys(f["category"] for f in visible):
        selected = [f for f in visible if f["category"] == category]
        category_stats[category] = {"files": len(selected), "bytes": sum(f["bytes"] or 0 for f in selected),
                                    "extensions": dict(collections.Counter(f["extension"] for f in selected))}
    return {
        "investigation_id": accession, "version": version, "title": metadata["title"],
        "acronym": metadata.get("investigationAcronym"), "research_area": metadata.get("researchArea"),
        "project_type": metadata.get("projectType"), "dataset_doi": metadata.get("doi"),
        "in_combustion_scope": metadata.get("researchArea") == "Combustion Science",
        "source_url": f"{BASE_URL}/physci/repo/data/investigations/{accession}",
        "file_listing_request": {"endpoint": BASE_URL + "/geode-py/ws/files/v2", "method": "POST",
                                 "body": {"folder": accession + "/", "fileType": "study", "studyId": accession, "version": version}},
        "metadata_total_bytes": metadata.get("totalFileSize"),
        "visible_files": len(visible), "all_file_nodes": len(files), "virtual_folders": len(folders),
        "visible_bytes": sum(f["bytes"] or 0 for f in visible),
        "source_file_references": sum(f["reference_count"] for f in files),
        "source_reference_bytes": sum((f["bytes"] or 0) * f["reference_count"] for f in files),
        "missing_byte_sizes": sum(f["bytes"] is None for f in visible),
        "restricted_files": sum(bool(f["restricted"]) for f in visible),
        "duplicate_tree_references": duplicates, "root_categories": [n.get("displayName") or PurePosixPath(n["key"].rstrip("/")).name for n in listing["files"]],
        "categories": category_stats, "extensions": dict(collections.Counter(f["extension"] for f in visible)),
        "experimental_tables": metadata.get("experimentalTable", []),
        "modeling_tables": metadata.get("modelingTable", []),
        "files": files, "folders": folders,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, help="Analyze a previously acquired audit snapshot offline")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "outputs/psi-file-audit-2026-11-14")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.snapshot:
        run_dir = args.snapshot.resolve()
        manifest = json.loads((run_dir / "manifest.json").read_text())
        results = []
        for entry in manifest["investigations"]:
            accession = entry["investigation_id"]
            for suffix, expected_hash in entry["sha256"].items():
                if hashlib.sha256((run_dir / f"{accession}.{suffix}.json").read_bytes()).hexdigest() != expected_hash:
                    raise ValueError("Snapshot hash mismatch: " + accession + "." + suffix)
            results.append(summarize(
                json.loads((run_dir / (accession + ".metadata.json")).read_text()),
                json.loads((run_dir / (accession + ".files.json")).read_text()),
            ))
    else:
        now = datetime.now(timezone.utc)
        run_dir = REPOSITORY_ROOT / "data/raw" / ("file-audit-" + now.strftime("%Y%m%dT%H%M%S%fZ"))
        run_dir.mkdir(parents=True, exist_ok=False)
        hits = search_investigations("combustion")
        (run_dir / "search.json").write_text(json.dumps(hits, ensure_ascii=False, indent=2))
        ids = sorted((h["_source"]["Accession"] for h in hits), key=lambda s: int(s.split("-")[1]))

        def fetch_one(accession):
            metadata = get_json(f"{BASE_URL}/geode-py/ws/repo/investigations/{accession}")
            if metadata.get("accession") != accession or metadata.get("public") is not True:
                raise ValueError("Unexpected or non-public investigation response")
            listing, _ = file_listing(accession, metadata["version"])
            for suffix, content in [("metadata", metadata), ("files", listing)]:
                (run_dir / f"{accession}.{suffix}.json").write_text(json.dumps(content, ensure_ascii=False, indent=2))
            summary = summarize(metadata, listing)
            print(accession, "v" + str(metadata["version"]), summary["visible_files"], "files", summary["visible_bytes"], "bytes", flush=True)
            return summary

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(fetch_one, ids))
        manifest = {"retrieved_at_utc": now.isoformat(), "search_url": "https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation",
                    "search_count": len(hits), "snapshot_directory": str(run_dir), "investigations": []}
        for result in results:
            accession = result["investigation_id"]
            hashes = {suffix: hashlib.sha256((run_dir / f"{accession}.{suffix}.json").read_bytes()).hexdigest() for suffix in ["metadata", "files"]}
            manifest["investigations"].append({"investigation_id": accession, "version": result["version"], "sha256": hashes})
        (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    inventory = {"manifest": manifest, "investigations": results}
    (args.output / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2))
    print("SNAPSHOT", run_dir)
    print("INVENTORY", args.output / "inventory.json")


if __name__ == "__main__":
    main()
