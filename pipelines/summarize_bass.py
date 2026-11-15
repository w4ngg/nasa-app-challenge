"""Build text-only PSI-25 summaries from the catalog and reviewed report facts.

Offline and deterministic. The report transcription is explicitly reviewed in
data/reference/psi25-reviewed-results.json; this is not PDF figure digitization,
an LLM extraction, or a reconstruction of missing time histories.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
CATALOG_NAME = "PSI-25_Experimental table_BASS-II.csv"
REPORT_URL = "https://ntrs.nasa.gov/api/citations/20210011385/downloads/TM-20210011385.pdf"
GASES = (
    ("o2", "Calibrated O₂", "vol %", "Calibrated initial O2 % by vol", "Calibrated final O2 % by vol", 100),
    ("co2", "CO₂", "vol %", "Initial CO2 % by vol", "Final CO2 % by vol", 100),
    ("co", "CO", "ppm", "Initial CO (ppm)", "Final CO (ppm)", None),
)
REQUIRED = ["PI", "Test #", "Date", "GMT", "Sample #", "Fuel Sample Material", "Flow restrictor", "Fan display", "Air display",
            *[column for gas in GASES for column in gas[3:5]]]


def gas_cell(raw: str, maximum: int | None) -> dict:
    text = raw.strip()
    if not text or re.fullmatch(r"none|n/?a|[-–—]", text, re.I):
        return {"raw": raw, "value": None, "issue": "Missing source reading"}
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?", text, re.I):
        return {"raw": raw, "value": None, "issue": "Qualified or non-numeric source reading"}
    value = Decimal(text)
    if not value.is_finite() or value < 0 or maximum is not None and value > maximum or not math.isfinite(float(value)):
        return {"raw": raw, "value": None, "issue": "Outside declared bounds; original reading retained"}
    return {"raw": raw, "value": float(value), "issue": None}


def source(reviewed: dict, key: str, role: str, locator: str, page: int | None = None) -> dict:
    item = reviewed[key if key in ["catalog", "readme"] else "report"]
    download = "https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?" + urlencode({
        "file": item["file_id"], "version": item["file_version"], "studyVersion": reviewed["investigation_version"], "redirect": "true"})
    return {"key": key, "name": item["name"], "role": role, "locator": locator,
            "url": download if key in ["catalog", "readme"] else f"{REPORT_URL}#page={page}",
            "download_url": download, "file_id": item["file_id"], "file_version": item["file_version"], "sha256": item["sha256"]}


def metric(key: str, label: str, value: Decimal, unit: str, formula: str, inputs: list[str], source_key: str) -> dict:
    return {"key": key, "label": label, "value": float(value), "unit": unit,
            "formula": formula, "inputs": inputs, "source_key": source_key}


def build(table: dict, reviewed: dict) -> dict:
    if reviewed.get("schema_version") != 1 or reviewed.get("investigation_id") != "PSI-25":
        raise ValueError("Unexpected reviewed source profile")
    if table.get("investigation_id") != "PSI-25" or table.get("file_name") != CATALOG_NAME:
        raise ValueError("Unexpected BASS-II catalog")
    if not set(REQUIRED).issubset(table["columns"]):
        raise ValueError("BASS-II catalog schema changed")
    if any(len(row) != len(table["columns"]) for row in table["rows"]):
        raise ValueError("BASS-II source row width changed")
    report_table = reviewed["table_5_1"]
    result_rows = [dict(zip(report_table["columns"], row, strict=True)) for row in report_table["rows"]]
    reported = {row["test_id"]: row for row in result_rows}
    if len(reported) != len(result_rows):
        raise ValueError("Duplicate report test identifiers")
    tests = []
    ids = set()
    linked = set()
    for ordinal, raw in enumerate(table["rows"], 1):
        row = dict(zip(table["columns"], raw, strict=True))
        test_id = row["Test #"]
        if not test_id or test_id in ids:
            raise ValueError("Missing or duplicate BASS-II test identifier")
        ids.add(test_id)
        result = reported.get(test_id)
        if result and row["PI"] != "Miller":
            raise ValueError("Miller result matched a different investigator")
        gas = []
        derived = []
        for key, label, unit, before, after, maximum in GASES:
            initial, final = gas_cell(row[before], maximum), gas_cell(row[after], maximum)
            gas.append({"key": key, "label": label, "unit": unit, "initial": initial, "final": final, "source_key": "catalog"})
            if initial["value"] is not None and final["value"] is not None:
                delta = Decimal(final["raw"].strip()) - Decimal(initial["raw"].strip())
                derived.append(metric(f"delta_{key}", f"{label}: final − initial", delta,
                                      "ppm" if unit == "ppm" else "percentage points", "final − initial", [before, after], "catalog"))
        sources = [source(reviewed, "catalog", "Experimental table", f"Data row {ordinal} · {test_id}")]
        conditions = [{"label": label, "value": row[column] or "Not recorded", "source_key": "catalog"} for label, column in (
            ("Investigator", "PI"), ("Test date", "Date"), ("Sample", "Sample #"), ("Material description (catalog)", "Fuel Sample Material"),
            ("Flow restrictor", "Flow restrictor"), ("Fan display / settings (source text)", "Fan display"), ("Air display (cm/s; source sequence)", "Air display"))]
        opening = f"BASS-II test {test_id} is listed by {row['PI']} on {row['Date']} for sample {row['Sample #'] or 'not recorded'}."
        if row["Fuel Sample Material"]:
            opening += f" The catalog material description is ‘{row['Fuel Sample Material']}’."
        notes = reviewed["reviewed_notes"].get(test_id)
        conflicts = []
        limits = [
            "No reviewed continuous time history is included. Before/after readings are not a reconstructed concentration profile.",
            "Gas concentration changes are not mass consumption, heat release rate, or a flammability limit.",
            "Air display is documented in cm/s with a slow response; source sequences are not single constant velocities. Fan/pot settings require the relevant calibration before conversion to airflow.",
            "Pressure and an exact extinction airflow are not supplied by this summary. No missing value is imputed.",
        ]
        reported_result = None
        if result:
            linked.add(test_id)
            for key in ["thickness_mm", "width_cm", "burn_time_min"]:
                if not isinstance(result[key], (int, float)) or not 0 < result[key] < float("inf"):
                    raise ValueError(f"Invalid report value: {test_id} / {key}")
            if result["burning_sides"] not in [1, 2]:
                raise ValueError("Invalid reported burning-side count")
            velocities, rates = result["airflow_cm_s"], result["spread_rate_mm_s"]
            if not velocities or rates is not None and len(velocities) != len(rates):
                raise ValueError("Unpaired airflow/spread-rate values")
            if any(not isinstance(v, (int, float)) or not 0 <= v < float("inf") for v in velocities + (rates or [])):
                raise ValueError("Invalid airflow or spread-rate value")
            for key, gas_key in [("initial_o2_vol_pct", "initial"), ("final_o2_vol_pct", "final")]:
                if gas[0][gas_key]["value"] != result[key]:
                    raise ValueError(f"Report/catalog oxygen mismatch for {test_id}; review the join")
            sources.append(source(reviewed, "table5_1", "Reported results", f"Table 5.1 · printed p. {report_table['printed_page']} · PDF p. {report_table['pdf_page']} · {test_id}", report_table["pdf_page"]))
            reported_result = {**{k: result[k] for k in ["thickness_mm", "width_cm", "burning_sides", "burn_time_min"]},
                               "flow_spread_pairs": [{"airflow_cm_s": v, "spread_rate_mm_s": rates[i] if rates is not None else None} for i, v in enumerate(velocities)],
                               "spread_status": "reported" if rates is not None else "Not tracked", "source_key": "table5_1"}
            opening += f" Table 5.1 reports {result['burning_sides']}-sided burning, a thickness of {result['thickness_mm']:g} mm and a burn time of {result['burn_time_min']:g} min."
            if rates is None:
                opening += " The spread rate is recorded as ‘Not tracked’."
            else:
                opening += f" It lists {len(velocities)} airflow/spread-rate pair{'s' if len(velocities) != 1 else ''} within this test."
            derived.append(metric("burn_time_s", "Reported burn time converted to seconds", Decimal(str(result["burn_time_min"])) * 60, "s", "reported minutes × 60", ["Table 5.1: Burn time (min)"], "table5_1"))
            limits.append("Flow/rate pairs are settings from one experiment, not independent replicates or a timed sequence. Changing oxygen, fuel state and flow prevent attributing the differences solely to airflow. No uncertainty or significance test is available here.")
        else:
            limits.append("This profile has catalog readings only. Test-specific report outcomes and researcher notes have not yet been reviewed; this does not establish that they are absent from NASA's archive.")
        researcher_notes = None
        interpretation = None
        if notes:
            if not result or any(row[c] != notes[k] for c, k in [("PI", "pi"), ("Sample #", "sample_id"), ("Date", "date")]):
                raise ValueError("Reviewed researcher notes do not match the catalog identity")
            researcher_notes = notes["verbatim"]
            interpretation = notes["interpretation"]
            conflicts = list(notes["source_conflicts"])
            sources.append(source(reviewed, "notes", "Researcher observations", f"{notes['table']} · printed p. {notes['printed_page']} · PDF p. {notes['pdf_page']} · {test_id}", notes["pdf_page"]))
            limits.append("‘Pot 0.4’ is a fan potentiometer setting, not 0.4 cm/s. No extinction velocity is calculated from it.")
            if test_id == "M8":
                pairs = {p["airflow_cm_s"]: p["spread_rate_mm_s"] for p in reported_result["flow_spread_pairs"]}
                relative = (Decimal(str(pairs[5])) / Decimal(str(pairs[10])) - 1) * 100
                derived.append(metric("spread_change_5_vs_10", "Reported spread rate at 5 vs 10 cm/s", relative, "%", "(rate at 5 / rate at 10 − 1) × 100", ["Table 5.1: M8, 5 cm/s → 0.040 mm/s", "Table 5.1: M8, 10 cm/s → 0.057 mm/s"], "table5_1"))
        tests.append({"test_id": test_id, "pi": row["PI"], "sample_id": row["Sample #"], "date": row["Date"],
                      "row_ordinal": ordinal, "catalog_row": raw, "summary": opening, "conditions": conditions,
                      "coverage": "results_and_notes" if notes else "reported_results" if result else "catalog_only",
                      "gas_readings": gas, "reported_result": reported_result, "derived_metrics": derived,
                      "researcher_notes": researcher_notes, "interpretation": interpretation, "source_conflicts": conflicts,
                      "limits": limits, "sources": sources, "time_series": None})
    if linked != set(reported):
        raise ValueError("Some reviewed report tests could not be linked to this catalog")
    return {"schema_version": 1, "investigation_id": "PSI-25", "investigation_version": reviewed["investigation_version"],
            "source_snapshot": reviewed["source_snapshot"], "catalog_file": CATALOG_NAME, "catalog_sha256": reviewed["catalog"]["sha256"],
            "catalog_columns": table["columns"], "method": reviewed["review_method"], "tests": tests,
            "measurement_guide": source(reviewed, "readme", "Measurement definitions", "Investigation-level field definitions, calibration notes and display response; not test-specific outcomes"),
            "coverage": {"tests": len(tests), "reported_results": len(linked), "with_spread_rates": sum(t["reported_result"] is not None and t["reported_result"]["spread_status"] == "reported" for t in tests),
                         "with_notes": sum(t["researcher_notes"] is not None for t in tests), "catalog_only": sum(t["coverage"] == "catalog_only" for t in tests)}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "apps/web/public/data/tables/PSI-25.json")
    parser.add_argument("--reviewed", type=Path, default=ROOT / "data/reference/psi25-reviewed-results.json")
    parser.add_argument("--output", type=Path, default=ROOT / "apps/web/public/data/bass-ii/summaries.json")
    args = parser.parse_args()
    reviewed = json.loads(args.reviewed.read_text())
    content = args.catalog.read_bytes()
    if hashlib.sha256(content).hexdigest() != reviewed["catalog"]["export_sha256"]:
        raise ValueError("Catalog export changed; review the source snapshot before rebuilding summaries")
    tables = json.loads(content)
    if len(tables) != 1:
        raise ValueError("Unexpected PSI-25 table set")
    data = build(tables[0], reviewed)
    data["reviewed_source_sha256"] = hashlib.sha256(args.reviewed.read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(args.output)
    print(json.dumps(data["coverage"]))


if __name__ == "__main__":
    main()
