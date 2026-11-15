"""Build source-traceable PSI-69 test summaries and static history assets.

Only downloads the small, catalog-matched TestSheet and image-derived TXT
series. Images, videos and large archives are outside this pipeline's scope.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import hashlib
import json
import math
import re
import statistics
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/documents/psi69-summaries"
OUTPUT = ROOT / "apps/web/public/data/flex"
INVENTORY = ROOT / "data/reference/psi69-sources.json"
CATALOG_NAME = "PSI-69_Experimental table_FLEX.csv"
ROLES = ("TestSheet", "DropletData", "LLUVData", "ColorCamData")
PATTERN = re.compile(r"FLEX-(\d+)_(TestSheet|DropletData|LLUVData|ColorCamData)\.txt$")


def write_json(path: Path, content) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(path)


def source_url(item: dict, redirect: bool = True) -> str:
    query = urllib.parse.urlencode({"file": item["file_id"], "version": item["file_version"],
                                    "studyVersion": item["investigation_version"],
                                    "redirect": str(redirect).lower()})
    return "https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?" + query


def prepare_inventory(audit: Path) -> dict:
    catalog = None
    candidates = []
    with gzip.open(audit, "rt") as stream:
        for line in stream:
            item = json.loads(line)
            if item.get("investigation_id") != "PSI-69":
                continue
            if item["name"] == CATALOG_NAME:
                catalog = {k: item[k] for k in ("name", "file_id", "file_version", "investigation_version", "bytes")}
            match = PATTERN.search(item["name"])
            if match:
                candidates.append({**{k: item[k] for k in ("name", "file_id", "file_version", "investigation_version", "bytes", "display_path")},
                                   "test_id": str(int(match[1])), "role": match[2]})
    if catalog is None:
        raise ValueError("PSI-69 experimental table not found")
    # File numbering and catalog numbering diverge; include the complete source
    # set and resolve physical identities by CIR before assigning any series.
    identities = [(x["test_id"], x["role"]) for x in candidates]
    if len(identities) != len(set(identities)):
        raise ValueError("Ambiguous source mapping: resolve file versions explicitly")
    data = {"investigation_id": "PSI-69", "investigation_version": catalog["investigation_version"],
            "snapshot_date": "2026-11-14", "catalog": catalog,
            "files": sorted(candidates, key=lambda x: (int(x["test_id"]), x["role"]))}
    write_json(INVENTORY, data)
    return data


def fetch(inventory: dict, workers: int) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest_path = CACHE / "manifest.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"files": []}
    records = {x["file_id"]: x for x in old["files"]}
    # Reuse previously downloaded, hash-verified audit and FLEX case-study files.
    cached = {}
    for path in (ROOT / "data/documents").glob("*/manifest.json"):
        if path == manifest_path:
            continue
        manifest = json.loads(path.read_text())
        for item in manifest.get("files", []):
            if item.get("file_id") and item.get("local_path"):
                cached[item["file_id"]] = item
    items = [inventory["catalog"], *inventory["files"]]
    start = time.monotonic()
    errors = []

    def download(item):
        if not 0 < item["bytes"] <= 2_000_000:
            raise ValueError("Source exceeds bounded download size")
        path = CACHE / f"{item['file_id']}{Path(item['name']).suffix}"
        if not path.exists() and item["file_id"] in cached:
            previous = cached[item["file_id"]]
            source = Path(previous["local_path"])
            if source.exists():
                content = source.read_bytes()
                if hashlib.sha256(content).hexdigest() == previous["sha256"]:
                    path.write_bytes(content)
        if path.exists():
            content = path.read_bytes()
            recorded = records.get(item["file_id"])
            if len(content) != int(item["bytes"]) or (recorded and hashlib.sha256(content).hexdigest() != recorded["sha256"]):
                raise ValueError(f"Cached source changed: {item['name']}")
        else:
            for attempt in range(4):
                try:
                    request = urllib.request.Request(source_url(item, False), headers={"User-Agent": "FlameAtlas-Research/0.1"})
                    with urllib.request.urlopen(request, timeout=40) as response:
                        signed = response.read().decode().strip().strip('"')
                    if not signed.startswith("https://"):
                        raise ValueError("NASA did not return an HTTPS file URL")
                    with urllib.request.urlopen(signed, timeout=40) as response:
                        content = response.read(2_000_001)
                    if len(content) != int(item["bytes"]):
                        raise ValueError("Downloaded size differs from the source inventory")
                    path.write_bytes(content)
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(1 + attempt * 2)
        return {**item, "local_path": str(path.relative_to(ROOT)),
                "download_url": source_url(item), "sha256": hashlib.sha256(content).hexdigest()}

    def checkpoint():
        write_json(manifest_path, {"investigation_id": "PSI-69", "files": list(records.values()), "errors": errors})

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        tasks = {pool.submit(download, item): item for item in items}
        for completed, task in enumerate(concurrent.futures.as_completed(tasks), 1):
            item = tasks[task]
            try:
                record = task.result()
                records[item["file_id"]] = record
            except Exception as error:
                errors.append({"file_id": item["file_id"], "name": item["name"], "error": str(error)})
            if completed % 25 == 0 or completed == len(items):
                checkpoint()
                print(f"FETCH {completed}/{len(items)}; errors={len(errors)}; elapsed={time.monotonic()-start:.0f}s", flush=True)
    if errors:
        raise RuntimeError(f"{len(errors)} source downloads failed; rerun --fetch to resume")


def decode(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252")


def scalar(value: str, minimum: float = 0, maximum: float = math.inf) -> float | None:
    text = value.strip()
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", text):
        return None
    number = float(text)
    return number if math.isfinite(number) and minimum <= number <= maximum else None


def read_series(text: str, role: str) -> dict:
    prefix = {"DropletData": "Droplet", "LLUVData": "LLUV", "ColorCamData": "ColorCam"}[role]
    time_column = prefix + "Time_sec"
    diameter_column = "DropletDiameter_mm" if role == "DropletData" else prefix + "FlameDiameter_mm"
    reader = csv.DictReader(text.splitlines(), delimiter="\t")
    if not reader.fieldnames or not {time_column, diameter_column}.issubset(reader.fieldnames):
        return {"points": [], "time_column": time_column, "value_column": diameter_column,
                "count": 0, "invalid_count": 0, "gaps": 0, "error": "Expected time/diameter columns were not found."}
    points, invalid, non_increasing = [], 0, 0
    for row in reader:
        t = scalar(row.get(time_column) or "", -math.inf)
        d = scalar(row.get(diameter_column) or "")
        if t is None:
            invalid += 1
            continue
        if d is None:
            invalid += 1
        if points and t <= points[-1][0]:
            non_increasing += 1
        points.append([t, d])
    intervals = [b[0]-a[0] for a, b in zip(points, points[1:]) if b[0] > a[0]]
    gap_limit = max(.25, statistics.median(intervals) * 5) if intervals else .25
    gaps = sum(b[0]-a[0] > gap_limit or b[0] <= a[0] for a, b in zip(points, points[1:]))
    valid = [p for p in points if p[1] is not None]
    return {"points": points, "time_column": time_column, "value_column": diameter_column,
            "count": len(points), "invalid_count": invalid, "gaps": gaps,
            "non_increasing_count": non_increasing, "gap_limit_s": gap_limit,
            "range_s": [valid[0][0], valid[-1][0]] if valid else None, "error": None}


def test_notes(text: str) -> tuple[str, str | None, str | None]:
    match = re.search(r"COMMENTS\s*:\s*(.*)", text, re.I | re.S)
    notes = " ".join(match[1].split()) if match else ""
    cir = re.search(r"CIR Test Number\s*:\s*([^\s]+)", text, re.I)
    fiber = re.search(r"Fiber\s*:\s*(Yes|No)\b", text, re.I)
    return notes, cir[1] if cir else None, fiber[1].capitalize() if fiber else None


def excerpt(notes: str) -> str | None:
    if not notes:
        return None
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", notes)
    # Keep the author's actual words, including any qualifications or negation.
    mechanisms = [i for i, s in enumerate(sentences) if re.search(r"cool[- ]flame|evidence|indicative", s, re.I)]
    if mechanisms:
        i = mechanisms[-1]
        return " ".join(sentences[max(0, i-1):i+1])
    relevant = [s for s in sentences if re.search(r"radiativ|diffusive|suggest|because|due to|consistent", s, re.I)]
    return " ".join((relevant or sentences)[:2])


def map_sources(rows: list[dict], files: list[dict], read) -> dict:
    """Resolve catalog identities without assuming equal file/test numbers."""
    catalog_cirs = {r["FLEX Identifier"].upper() for r in rows}
    identifier = re.compile(r"(?<![A-Za-z0-9])(" + "|".join(re.escape(c) for c in sorted(catalog_cirs, key=len, reverse=True)) + r")(?![A-Za-z0-9])", re.I)
    groups = {}
    for item in files:
        groups.setdefault(item["test_id"], {})[item["role"]] = item
    by_cir = {}
    for source_id, roles in groups.items():
        sheet_text = read(roles["TestSheet"]) if "TestSheet" in roles else ""
        _, sheet_cir, _ = test_notes(sheet_text)
        path_cirs = {m.upper() for item in roles.values() for m in identifier.findall(item.get("display_path", ""))}
        title = re.search(r"FLEX[-–\s]*(\d+)", sheet_text[:100])
        copied_sheet = bool(title and int(title[1]) != int(source_id) and len(path_cirs) == 1
                            and (sheet_cir or "").upper() not in path_cirs)
        # Folder labels also contain errors. Prefer the TestSheet CIR, except
        # when the entire sheet identifies another numbered test (FLEX-128).
        cir = next(iter(path_cirs)) if copied_sheet else (sheet_cir or "").upper()
        warnings = []
        if path_cirs and cir not in path_cirs and not copied_sheet:
            warnings.append(f"Source folder label lists {', '.join(sorted(path_cirs))}, while the TestSheet lists CIR {cir}. Files are joined by their shared source-test filename and TestSheet CIR; the folder label is not used as the test identity.")
        if title and int(title[1]) != int(source_id):
            warnings.append(f"The TestSheet title says FLEX-{int(title[1]):03}, but the filename says FLEX-{int(source_id):03}. The differing source labels are retained for review.")
        group = {"source_test_id": source_id, "roles": roles, "sheet_text": sheet_text,
                 "sheet_cir": sheet_cir, "cir": cir,
                 "warnings": warnings,
                 "basis": "CIR identifier in source folder; copied TestSheet excluded" if copied_sheet else "CIR identifier in NASA TestSheet"}
        by_cir.setdefault(cir, []).append(group)
    result = {}
    for row in rows:
        candidates = by_cir.get(row["FLEX Identifier"].upper(), [])
        if len(candidates) > 1:
            d0 = scalar(row["Droplet initial diameter; mm"])
            matching = []
            for group in candidates:
                match = re.search(r"D0\s*\(mm\)\s*=\s*([^\s]+)", group["sheet_text"])
                source_d0 = scalar(match[1]) if match else None
                if d0 is not None and source_d0 is not None and abs(source_d0-d0) < .005:
                    matching.append(group)
            candidates = matching
        result[row["FLEX Test #"]] = candidates[0] if len(candidates) == 1 else None
    return result


def sheet_conflicts(row: dict, text: str) -> list[str]:
    conflicts = []
    for label, pattern, column, tolerance in (
        ("O₂", r"O2 Mole Fraction\s*=\s*([^\s]+)", "O initial ambient composition; mole fraction", .011),
        ("N₂", r"N2 Mole Fraction\s*=\s*([^\s]+)", "N initial ambient composition; mole fraction", .011),
        ("CO₂", r"CO2 Mole Fraction\s*=\s*([^\s]+)", "CO initial ambient composition; mole fraction", .011),
        ("He", r"He Mole Fraction\s*=\s*([^\s]+)", "He initial ambient composition; mole fraction", .011),
        ("Initial diameter (mm)", r"D0\s*\(mm\)\s*=\s*([^\s]+)", "Droplet initial diameter; mm", .051),
    ):
        match = re.search(pattern, text)
        value = scalar(match[1]) if match else None
        catalog_value = scalar(row[column])
        if value is not None and catalog_value is not None and abs(value-catalog_value) > tolerance:
            conflicts.append(f"{label}: catalog {row[column]}; TestSheet {match[1]}. Both source values are retained; resolve the difference before comparing conditions.")
    return conflicts


def fit_interval(points: list, start: float, end: float) -> dict | None:
    pairs = [(t, d*d) for t, d in points if d is not None and start <= t <= end]
    if len(pairs) < 3:
        return None
    mx, my = statistics.mean(t for t, d in pairs), statistics.mean(d for t, d in pairs)
    variance = sum((t-mx)**2 for t, d in pairs)
    if variance == 0:
        return None
    slope = sum((t-mx)*(d-my) for t, d in pairs) / variance
    intercept = my - slope*mx
    total = sum((d-my)**2 for t, d in pairs)
    return {"window_s": [start, end], "points": len(pairs), "k_mm2_s": -slope,
            "intercept_mm2": intercept,
            "r_squared": 1-sum((d-intercept-slope*t)**2 for t, d in pairs)/total if total else None}


def build(inventory: dict) -> dict:
    manifest = json.loads((CACHE / "manifest.json").read_text())
    cached = {x["file_id"]: x for x in manifest["files"]}
    expected = [inventory["catalog"], *inventory["files"]]
    missing = [x["name"] for x in expected if x["file_id"] not in cached]
    if missing:
        raise ValueError(f"Download the source set first: {len(missing)} files not cached")

    def read(item):
        source = cached[item["file_id"]]
        path = Path(source["local_path"])
        content = (path if path.is_absolute() else ROOT / path).read_bytes()
        if hashlib.sha256(content).hexdigest() != source["sha256"]:
            raise ValueError(f"Source hash mismatch: {item['name']}")
        return decode(content)

    catalog_text = read(inventory["catalog"])
    reader = csv.reader(catalog_text.splitlines())
    columns = [" ".join(c.split()) for c in next(reader)]
    body = [[c.strip() for c in row] for row in reader if any(c.strip() for c in row)]
    ids = [row[columns.index("FLEX Test #")] for row in body]
    if len(ids) != len(set(ids)) or set(ids) != {str(i) for i in range(1, 275)}:
        raise ValueError("Experimental-table test identities differ from this reviewed inventory")
    catalog_records = [dict(zip(columns, raw)) for raw in body]
    mapping = map_sources(catalog_records, inventory["files"], read)

    index = {"schema_version": 1, "investigation_id": "PSI-69", "investigation_version": inventory["investigation_version"],
             "source_snapshot": inventory["snapshot_date"], "catalog_file": CATALOG_NAME,
             "catalog_sha256": cached[inventory["catalog"]["file_id"]]["sha256"],
             "method": "Deterministic summaries of catalog measurements, with attributed NASA test-sheet excerpts; no model-generated scientific claims.",
             "context_publications": [
                 {"title": "Detailed Results from FLEX (NASA/TP-2015-216046)", "url": "https://ntrs.nasa.gov/citations/20150023456", "role": "Measurement definitions and methods"},
                 {"title": "Dietrich et al. (2014): Droplet Combustion Experiments Aboard the ISS", "url": "https://doi.org/10.1007/s12217-014-9372-2", "role": "Investigation-level interpretation; not a test-specific citation"}],
             "tests": []}
    history_dir = OUTPUT / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    coverage = {"tests": len(ids), "test_sheets": 0, "with_history": 0, "droplet_series": 0,
                "lluv_series": 0, "color_series": 0, "catalog_only": 0, "series_parse_errors": 0,
                "renumbered_records": 0, "source_conflicts": 0}
    series_keys = {"DropletData": "droplet", "LLUVData": "lluv", "ColorCamData": "color"}
    for ordinal, raw in enumerate(body, 1):
        row = dict(zip(columns, raw))
        test_id = row["FLEX Test #"]
        mapped = mapping[test_id]
        source_test_id = mapped["source_test_id"] if mapped else None
        test_name = f"FLEX-{int(source_test_id):03}" if source_test_id else f"Catalog test {test_id}"
        cir = row["FLEX Identifier"]
        sources = [{"role": "catalog", "name": CATALOG_NAME, "url": source_url(inventory["catalog"]),
                    "file_id": inventory["catalog"]["file_id"], "file_version": inventory["catalog"]["file_version"],
                    "sha256": cached[inventory["catalog"]["file_id"]]["sha256"], "row_ordinal": ordinal}]
        roles, notes, fiber = mapped["roles"] if mapped else {}, "", None
        series = {}
        limits = []
        conflicts = list(mapped["warnings"]) if mapped else []
        if source_test_id and source_test_id != test_id:
            coverage["renumbered_records"] += 1
            limits.append(f"Catalog test {test_id} corresponds to source {test_name}, joined by CIR {cir}; file numbering is different.")
        if sum(r["FLEX Identifier"] == cir for r in catalog_records) > 1:
            limits.append(f"More than one catalog record uses CIR {cir}. Source groups are distinguished using initial diameter; do not assume these are independent replicates.")
        for role, source in roles.items():
            text = read(source)
            source_record = cached[source["file_id"]]
            sources.append({"role": role, "name": source["name"], "url": source_url(source),
                            "file_id": source["file_id"], "file_version": source["file_version"], "sha256": source_record["sha256"]})
            if role == "TestSheet":
                notes, sheet_cir, fiber = test_notes(text)
                if sheet_cir and sheet_cir.casefold() != cir.casefold():
                    conflicts.append(f"{source['name']} identifies CIR {sheet_cir}, while its source folder identifies {cir}. These test notes and fiber values are excluded from the summary.")
                    notes, fiber = "", None
                else:
                    conflicts.extend(sheet_conflicts(row, text))
                    coverage["test_sheets"] += 1
            else:
                parsed = read_series(text, role)
                parsed["source_role"] = role
                parsed["source_file_id"] = source["file_id"]
                parsed["source_sha256"] = source_record["sha256"]
                series[series_keys[role]] = parsed
                if parsed["error"]:
                    coverage["series_parse_errors"] += 1
                    limits.append(f"{role}: {parsed['error']}")
                if parsed["invalid_count"]:
                    limits.append(f"{role}: {parsed['invalid_count']} invalid observations are left as gaps or omitted if time is invalid.")
                if parsed["gaps"]:
                    limits.append(f"{role}: {parsed['gaps']} timing gaps or reversals; the chart does not connect across them.")
        if "TestSheet" not in roles:
            limits.append("No test sheet was found in the reviewed source inventory; the narrative uses the catalog only.")
        if not notes:
            limits.append("No researcher commentary is available for this test.")
        if conflicts:
            coverage["source_conflicts"] += 1
        for role, label in (("DropletData", "droplet"), ("LLUVData", "LLUV flame"), ("ColorCamData", "color-camera flame")):
            if role not in roles:
                limits.append(f"No {label} history file was found in the reviewed source inventory.")

        d0 = scalar(row["Droplet initial diameter; mm"])
        dext = scalar(row["Visible flame extinction diameter; mm"])
        duration = scalar(row["Burn time; s"])
        pressure = scalar(row["Ambient pressure; mmHg"])
        fuel = row["Fuel"] or "Unspecified fuel"
        endpoint = row["Test end"] or "Not recorded"
        conditions = [{"label": "Fuel", "value": fuel}, {"label": "Test date", "value": row["Test Date"] or "Not recorded"},
                      {"label": "Initial droplet diameter", "value": f"{d0:g} mm" if d0 and d0 > 0 else "Not recorded"},
                      {"label": "Ambient pressure", "value": f"{pressure:g} mmHg" if pressure and pressure > 0 else "Not recorded"}]
        for column, label in (("O", "O₂"), ("N", "N₂"), ("CO", "CO₂"), ("He", "He")):
            value = scalar(row[f"{column} initial ambient composition; mole fraction"], 0, 1)
            conditions.append({"label": f"Initial {label}", "value": f"{value*100:g} mol %" if value is not None else "Not recorded"})
        conditions.append({"label": "Support fiber (test sheet)", "value": fiber or "Not recorded"})
        opening = f"{test_name} examined {fuel.lower()} droplet combustion"
        if d0 and d0 > 0:
            opening += f" with an initial droplet diameter of {d0:g} mm"
        if pressure and pressure > 0:
            opening += f" at {pressure:g} mmHg"
        summary = [opening + "."]
        outcome = f"The catalog records the test end as {endpoint.lower()}"
        if duration is not None:
            outcome += f" and a burn time of {duration:g} s"
        summary.append(outcome + ".")
        if dext is not None and dext > 0:
            summary.append(f"The reported droplet diameter at visible-flame extinction is {dext:g} mm.")
        elif dext == 0:
            limits.append("The source extinction-diameter cell is zero; it is not interpreted as a separately observed extinction event.")
        else:
            limits.append("The catalog does not provide an exact positive visible-flame extinction diameter.")
        if duration is None:
            limits.append(f"Recorded burn time is not an exact scalar: {row['Burn time; s'] or 'empty source cell'}.")

        available_series = [s for s in series.values() if any(p[1] is not None for p in s["points"])]
        history = {"schema_version": 1, "investigation_id": "PSI-69", "test_id": test_id, "cir_id": cir, "source_test_id": source_test_id,
                   "time_origin": "Igniters turned on; verify source timing when comparing files.",
                   "series": series, "recorded_endpoint_s": duration, "display_end_s": None, "fits": []}
        # This reviewed interval belongs only to the previously checked FLEX-035
        # case. Other tests are not assigned the same event or fit window.
        if test_id == "35" and series.get("droplet", {}).get("points"):
            points = series["droplet"]["points"]
            fit = fit_interval(points, 10, 30)
            if fit:
                fit["source_role"] = "DropletData"
                fit["label"] = "Reviewed interval after visible-flame extinction"
                history["fits"].append(fit)
                summary.append(f"An independent fit of D² over 10–30 s gives K ≈ {fit['k_mm2_s']:.3f} mm²/s ({fit['points']} time samples in this test).")
            history["display_end_s"] = 37.5
            limits.append("The default history view stops at 37.5 s because late diameter jumps require image review; all points remain available in the source files.")
        for key in series_keys.values():
            if series.get(key, {}).get("points"):
                coverage[{"droplet": "droplet_series", "lluv": "lluv_series", "color": "color_series"}[key]] += 1
        if available_series:
            coverage["with_history"] += 1
            write_json(history_dir / f"{test_id}.json", history)
        if not roles:
            coverage["catalog_only"] += 1
        index["tests"].append({"test_id": test_id, "name": test_name, "cir_id": cir,
                               "source_test_id": source_test_id, "source_match_basis": mapped["basis"] if mapped else "No verified source-group match",
                               "source_conflicts": conflicts,
                               "row_ordinal": ordinal, "catalog_row": raw,
                               "coverage": "series_and_notes" if available_series and notes else "series" if available_series else "notes" if notes else "catalog_only",
                               "summary": " ".join(summary), "conditions": conditions,
                               "recorded_outcome": {"test_end": endpoint, "burn_time_s": duration, "extinction_diameter_mm": dext},
                               "researcher_excerpt": excerpt(notes), "researcher_notes": notes or None,
                               "limits": limits, "sources": sources,
                               "history_path": f"history/{test_id}.json" if available_series else None,
                               "series_counts": {k: v["count"] for k, v in series.items()}})
    index["coverage"] = coverage
    expected_histories = {r["test_id"] for r in index["tests"] if r["history_path"]}
    for stale in history_dir.glob("*.json"):
        if stale.stem not in expected_histories:
            stale.unlink()
    write_json(OUTPUT / "summaries.json", index)
    print(json.dumps({**coverage, "output": str(OUTPUT)}, indent=2))
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-inventory", type=Path)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6)
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    inventory = prepare_inventory(args.prepare_inventory) if args.prepare_inventory else json.loads(INVENTORY.read_text())
    if args.fetch:
        fetch(inventory, args.workers)
    if args.build:
        build(inventory)


if __name__ == "__main__":
    main()
