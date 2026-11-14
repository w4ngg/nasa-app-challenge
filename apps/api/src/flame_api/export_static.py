"""Publish the normalized catalog as static JSON so the web app runs without a server.

Writes `index.json` (investigations, publications, links) and one
`tables/<PSI-ID>.json` per investigation with experimental tables, which the
detail page loads on demand.
"""
import argparse
import json
from pathlib import Path

from .config import REPOSITORY_ROOT
from .models import Catalog


def export(catalog: Catalog, destination: Path) -> dict[str, int]:
    tables_dir = destination / "tables"
    tables_dir.mkdir(parents=True, exist_ok=True)
    for stale in tables_dir.glob("PSI-*.json"):
        stale.unlink()
    index = catalog.model_dump(mode="json", exclude={"tables"})
    write(destination / "index.json", index)
    by_investigation: dict[str, list[dict]] = {}
    for table in catalog.tables:
        by_investigation.setdefault(table.investigation_id, []).append(table.model_dump(mode="json"))
    for investigation_id, tables in by_investigation.items():
        write(tables_dir / f"{investigation_id}.json", tables)
    return {"investigations": len(catalog.investigations), "table_files": len(by_investigation)}


def write(path: Path, content) -> None:
    path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=REPOSITORY_ROOT / "data/processed/catalog.json")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "apps/web/public/data")
    args = parser.parse_args()
    catalog = Catalog.model_validate_json(args.catalog.read_text(encoding="utf-8"))
    print(json.dumps({**export(catalog, args.output), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
