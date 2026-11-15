"""Biểu đồ cho câu hỏi về số liệu. Số liệu do code tính từ bảng thí nghiệm NASA PSI (không do LLM viết).

Nguồn: catalog của web (apps/web/public/data/index.json: điều kiện từng nghiên cứu, trích từ bảng thí nghiệm PSI)
và bảng thí nghiệm gốc (apps/web/public/data/tables/PSI-xx.json).

Mỗi biểu đồ là một spec JSON để web vẽ (SVG), kèm `table` (xem dạng bảng) và `notes` (giới hạn của dữ liệu):
  {"kind", "type": "range"|"bar"|"scatter", "title", "subtitle", "x_label", "y_label", "unit",
   "series": [{"key", "label"}], "rows"/"points"/"lines", "reference_lines", "notes", "source", "tags"}
"""
from __future__ import annotations

import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

from . import config

KINDS = ("oxygen_ranges", "run_counts", "fuel_runs", "flex_burn_time")
EARTH_AIR_O2 = 20.9


def web_data_dir() -> Path | None:
    """apps/web/public/data: trong repo là ../web; bản dev nằm cạnh repo nasa-app-challenge."""
    cands = [Path(config.CATALOG_JSON).parent,
             config.ROOT.parent / "nasa-app-challenge" / "apps" / "web" / "public" / "data"]
    return next((p for p in cands if (p / "index.json").exists()), None)


_CACHE: dict[str, object] = {}


def catalog() -> dict[str, dict]:
    if "catalog" not in _CACHE:
        d = web_data_dir()
        inv = json.loads((d / "index.json").read_text(encoding="utf-8"))["investigations"] if d else []
        _CACHE["catalog"] = {r["id"]: r for r in inv}
    return _CACHE["catalog"]  # type: ignore[return-value]


def table(psi_id: str) -> list[dict]:
    key = f"table:{psi_id}"
    if key not in _CACHE:
        d = web_data_dir()
        p = d / "tables" / f"{psi_id}.json" if d else None
        _CACHE[key] = json.loads(p.read_text(encoding="utf-8")) if p and p.exists() else []
    return _CACHE[key]  # type: ignore[return-value]


def _num(v) -> float | None:
    try:
        x = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return x if x == x else None  # bỏ NaN


def _name(r: dict) -> str:
    return f"{r['id']} {r.get('acronym') or ''}".strip()


def _resolve(names: list[str] | None) -> list[dict]:
    cat = catalog()
    if not names:
        return list(cat.values())
    out = []
    for n in names:
        k = str(n).strip().lower()
        hits = [r for r in cat.values() if k in (r["id"].lower(), (r.get("acronym") or "").lower())
                or (len(k) >= 3 and (r.get("acronym") or "").lower().startswith(k))]
        out += [h for h in hits if h not in out]
    return out


def oxygen_ranges(investigations: list[str] | None = None) -> dict:
    rows = []
    for r in _resolve(investigations):
        for o in r["conditions"].get("o2") or []:
            rows.append({"id": r["id"], "label": _name(r), "series": o["basis"], "min": o["min_percent"],
                         "max": o["max_percent"], "n": o.get("runs_with_value"),
                         "source_file": o.get("source_file"), "source_column": o.get("source_column")})
    rows.sort(key=lambda x: (-x["max"], x["label"]))
    series = [{"key": "ambient", "label": "Oxygen in the chamber air"},
              {"key": "oxidizer_stream", "label": "Oxygen in the burner's oxidizer stream"}]
    series = [s for s in series if any(x["series"] == s["key"] for x in rows)]
    return {
        "kind": "oxygen_ranges", "type": "range",
        "title": "Oxygen levels tested in each NASA PSI experiment",
        "subtitle": "Lowest to highest oxygen recorded in the experiment tables (percent)",
        "x_label": "Oxygen (%)", "unit": "%", "series": series, "rows": rows,
        "reference_lines": [{"value": EARTH_AIR_O2, "label": "Earth air 20.9%"},
                            {"value": 30.0, "label": "Planned Moon base ≥30%"}],
        "notes": ["Only experiments whose tables record oxygen are shown.",
                  "Oxidizer-stream values (inverse flames) are the gas fed to the burner, not the chamber air.",
                  "Moon-base level from the NASA Space Apps 2026 challenge statement (≥30% O₂ at ≤10.2 psi)."],
        "source": "NASA PSI experiment tables (via the team catalog)",
    }


def run_counts(investigations: list[str] | None = None) -> dict:
    rows = [{"id": r["id"], "label": _name(r), "value": r["conditions"].get("run_count") or 0}
            for r in _resolve(investigations)]
    rows = sorted([x for x in rows if x["value"]], key=lambda x: (-x["value"], x["label"]))
    return {"kind": "run_counts", "type": "bar", "title": "Experiment runs recorded per investigation",
            "subtitle": "Rows in the NASA PSI experiment tables", "x_label": "Runs", "unit": "runs",
            "series": [{"key": "runs", "label": "Runs"}], "rows": rows,
            "notes": ["Investigations without an experiment table on PSI are not shown."],
            "source": "NASA PSI experiment tables (via the team catalog)"}


def fuel_runs(investigation: str) -> dict:
    hits = _resolve([investigation])
    if not hits:
        return {"error": f"unknown investigation {investigation!r}"}
    r = hits[0]
    runs = r["conditions"].get("fuel_runs") or {}
    rows = sorted([{"id": r["id"], "label": f, "value": n} for f, n in runs.items()], key=lambda x: -x["value"])
    return {"kind": "fuel_runs", "type": "bar", "title": f"Runs per fuel or material in {_name(r)}",
            "subtitle": "Rows of the NASA PSI experiment table naming each fuel", "x_label": "Runs", "unit": "runs",
            "series": [{"key": "runs", "label": "Runs"}], "rows": rows, "investigation": r["id"],
            "notes": ["A run can test one sample; counts come from the fuel column of the experiment table."],
            "source": f"NASA PSI experiment table of {r['id']}"}


def flex_burn_time(fuel: str | None = None) -> dict:
    """FLEX (PSI-69): thời gian cháy theo O₂ ban đầu, từng giọt (điểm) + trung vị theo mức O₂ (đường)."""
    tbs = table("PSI-69")
    if not tbs:
        return {"error": "FLEX experiment table not available"}
    t = tbs[0]
    ix = {c: i for i, c in enumerate(t["columns"])}
    need = ("Fuel", "O initial ambient composition; mole fraction", "Burn time; s")
    if any(c not in ix for c in need):
        return {"error": "FLEX table columns changed"}
    pts = []
    for r in t["rows"]:
        f = str(r[ix["Fuel"]]).strip().lower()
        o2, bt = _num(r[ix[need[1]]]), _num(r[ix[need[2]]])
        if o2 is None or bt is None or bt <= 0 or not 0 < o2 <= 1:
            continue
        if fuel and fuel.lower().replace("n-", "") not in f:
            continue
        pts.append({"series": f, "x": round(o2 * 100, 1), "y": bt, "test": r[ix["FLEX Test #"]] if "FLEX Test #" in ix else "",
                    "end": r[ix["Test end"]] if "Test end" in ix else ""})
    if not pts:
        return {"error": f"no FLEX rows for fuel {fuel!r}"}
    lines, summary = [], {}
    for s in sorted({p["series"] for p in pts}):
        g = defaultdict(list)
        for p in pts:
            if p["series"] == s:
                g[round(p["x"])].append(p["y"])
        levels = [(k, v) for k, v in sorted(g.items()) if len(v) >= 3]   # trung vị chỉ khi ≥3 lần đốt
        lines.append({"series": s, "points": [{"x": k, "y": round(statistics.median(v), 1), "n": len(v)} for k, v in levels]})
        summary[s] = {"runs": sum(1 for p in pts if p["series"] == s),
                      "median_by_o2": [{"o2_percent": k, "median_burn_time_s": round(statistics.median(v), 1), "tests": len(v)}
                                       for k, v in levels]}
    labels = {"heptane": "n-Heptane", "methanol": "Methanol"}
    return {
        "kind": "flex_burn_time", "type": "scatter",
        "title": "FLEX: how long fuel droplets burned at each oxygen level",
        "subtitle": "Each dot is one droplet test on the ISS; lines join the median burn time at each oxygen level (≥3 tests)",
        "x_label": "Initial oxygen in the chamber (%)", "y_label": "Burn time (s)", "unit": "s",
        "series": [{"key": s, "label": labels.get(s, s.title())} for s in sorted({p["series"] for p in pts})],
        "points": pts, "lines": lines, "summary": summary,
        "reference_lines": [{"value": EARTH_AIR_O2, "label": "Earth air 20.9%", "axis": "x"}],
        "notes": ["Other conditions also changed between tests (pressure 0.7 or 1 atm, helium or CO₂ diluent, droplet size), "
                  "so this shows a pattern in the records, not the effect of oxygen alone.",
                  "Tests ended in different ways (extinction, disruption, completion); burn time is the time to that end."],
        "source": "NASA PSI-69 FLEX experiment table (PSI-69_Experimental table_FLEX.csv)",
        "investigation": "PSI-69",
    }


def build(kind: str, investigations: list[str] | None = None, investigation: str | None = None,
          fuel: str | None = None) -> dict:
    if kind not in KINDS:
        return {"error": f"unknown chart kind {kind!r}; use one of {list(KINDS)}"}
    if web_data_dir() is None:
        return {"error": "experiment data (apps/web/public/data) not found"}
    if kind == "oxygen_ranges":
        return oxygen_ranges(investigations)
    if kind == "run_counts":
        return run_counts(investigations)
    if kind == "fuel_runs":
        target = investigation or (investigations or [None])[0]
        return fuel_runs(target) if target else {"error": "fuel_runs needs an investigation"}
    return flex_burn_time(fuel)


def evidence_lines(spec: dict) -> dict[str, list[str]]:
    """Câu bằng chứng theo từng nghiên cứu (để gắn nhãn [I#] và để hậu kiểm thấy số liệu trong nguồn)."""
    out: dict[str, list[str]] = defaultdict(list)
    if spec["kind"] == "oxygen_ranges":
        for x in spec["rows"]:
            basis = "chamber air (ambient)" if x["series"] == "ambient" else "oxidizer stream"
            out[x["id"]].append(f"Oxygen tested in the {basis}: {x['min']:g}% to {x['max']:g}% "
                                f"({x['n']} runs with a value; {x['source_file']}, column {x['source_column']})")
    elif spec["kind"] in ("run_counts", "fuel_runs"):
        for x in spec["rows"]:
            what = f"{x['label']}: {x['value']} runs" if spec["kind"] == "fuel_runs" else f"{x['value']} experiment runs recorded"
            out[x["id"]].append(what)
    elif spec["kind"] == "flex_burn_time":
        for s, v in spec["summary"].items():
            meds = "; ".join(f"{m['median_burn_time_s']} s at {m['o2_percent']}% oxygen ({m['tests']} tests)"
                             for m in v["median_by_o2"])
            out["PSI-69"].append(f"FLEX {s}: {v['runs']} droplet tests with a burn time. Median burn time: {meds}")
    return out


def short_lines(spec: dict) -> list[tuple[str, str]]:
    """Một dòng ngắn cho mỗi nghiên cứu (dùng ở câu trả lời offline); chi tiết file/cột nằm trong bằng chứng."""
    out: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}
    if spec["kind"] == "oxygen_ranges":
        for x in spec["rows"]:
            names[x["id"]] = x["label"]
            where = "chamber air" if x["series"] == "ambient" else "burner oxidizer stream"
            out[x["id"]].append(f"{where} {x['min']:g}–{x['max']:g}%")
    elif spec["kind"] in ("run_counts", "fuel_runs"):
        for x in spec["rows"]:
            key = x["id"] if spec["kind"] == "run_counts" else x["label"]
            names[key] = x["label"]
            out[key].append(f"{x['value']} runs")
    elif spec["kind"] == "flex_burn_time":
        for s, v in spec["summary"].items():
            m = {r["o2_percent"]: r for r in v["median_by_o2"]}
            pick = [m[k] for k in sorted(m) if k in (min(m), 21, max(m))]
            names[s] = f"FLEX {s}"
            out[s].append("median burn time " + ", ".join(f"{r['median_burn_time_s']} s at {r['o2_percent']}% O₂" for r in pick))
    return [(names[k], "; ".join(v)) for k, v in out.items()]


def compact(spec: dict) -> dict:
    """Bản rút gọn gửi cho LLM (không gửi từng điểm dữ liệu)."""
    keep = {k: v for k, v in spec.items() if k not in ("points", "lines", "rows")}
    if "rows" in spec:
        keep["rows"] = [{k: v for k, v in x.items() if k in ("label", "series", "min", "max", "value", "n")}
                        for x in spec["rows"]][:30]
    return keep


def safe_slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
