"""Cầu nối sang Module 1 (search investigations) và Module 5 (predict).

Khi chưa có sản phẩm của các module kia, các hàm ở đây trả dữ liệu MOCK
(luôn có cờ `is_mock=True` để UI và câu trả lời ghi rõ).
"""
from __future__ import annotations

import csv
import importlib
import json
import re
from typing import Any, Callable

from . import config

# Schema bảng investigations theo meeting minute (Module 1). Tên cột có thể chỉnh khi Phú chốt.
INVESTIGATION_FIELDS = [
    "psi_id", "doi", "name", "year", "hardware", "fuel_type", "material",
    "o2_min", "o2_max", "pressure_kpa", "airflow_cm_s", "gravity", "has_results",
    "description", "link",
]


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def catalog_conditions() -> dict[str, dict]:
    """Conditions per PSI ID from the web catalog (apps/web/public/data/index.json).

    Fuel and oxygen there are read from each investigation's PSI experiment tables. Oxygen
    filters use the chamber-atmosphere range only; burner-fed oxygen is reported in the note.
    """
    if not config.CATALOG_JSON.exists():
        return {}
    out = {}
    for inv in json.loads(config.CATALOG_JSON.read_text(encoding="utf-8")).get("investigations", []):
        c = inv.get("conditions") or {}
        ambient = [o for o in c.get("o2", []) if o.get("basis") == "ambient"]
        burner = [o for o in c.get("o2", []) if o.get("basis") == "oxidizer_stream"]
        lo = min((o["min_percent"] for o in ambient), default=None)
        hi = max((o["max_percent"] for o in ambient), default=None)
        o2_range = f"{lo:g}–{hi:g} (chamber)" if lo is not None else ""
        if burner:
            b_lo, b_hi = min(o["min_percent"] for o in burner), max(o["max_percent"] for o in burner)
            o2_range = "; ".join(x for x in (o2_range, f"{b_lo:g}–{b_hi:g} (burner-fed)") if x)
        platform = inv.get("platform")
        out[inv["id"]] = {
            "fuel_type": ", ".join(c.get("fuel_categories", [])),
            "material": ", ".join(c.get("fuels", [])),
            "o2_min": "" if lo is None else lo, "o2_max": "" if hi is None else hi,
            "o2_range": o2_range,
            "gravity": {"iss": "microgravity (ISS)", "cygnus": "microgravity (Cygnus)", "ground": "1 g (ground study)"}.get(platform, ""),
            "runs": str(c.get("run_count") or ""),
        }
    return out


def _fill(row: dict, extra: dict | None) -> dict:
    for key, value in (extra or {}).items():
        if row.get(key) in (None, ""):
            row[key] = value
    return row


def load_investigations() -> list[dict]:
    if config.INVESTIGATIONS_FILE.exists():
        with open(config.INVESTIGATIONS_FILE, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        conditions = catalog_conditions()
        for r in rows:
            r["is_mock"] = False
            _fill(r, conditions.get(str(r.get("psi_id", ""))))
        return rows
    with open(config.MOCK_INVESTIGATIONS_FILE, encoding="utf-8") as f:
        rows = json.load(f)
    for r in rows:
        r["is_mock"] = True
    return rows


def search_investigations(query: str = "", fuel_type: str | None = None, material: str | None = None,
                          min_o2: float | None = None, max_o2: float | None = None,
                          gravity: str | None = None, hardware: str | None = None,
                          limit: int = 5) -> list[dict]:
    """Lọc investigations theo điều kiện có cấu trúc. Thay bằng search() của Module 1 khi có."""
    words = [w for w in query.lower().split() if len(w) > 2]
    out = []
    for r in load_investigations():
        hay = " ".join(str(r.get(k, "")) for k in ("psi_id", "name", "material", "fuel_type", "description")).lower()
        if fuel_type and fuel_type.lower() not in str(r.get("fuel_type", "")).lower():
            continue
        if material and material.lower() not in str(r.get("material", "")).lower():
            continue
        if gravity and gravity.lower() not in str(r.get("gravity", "")).lower():
            continue
        if hardware and hardware.lower() not in str(r.get("hardware", "")).lower():
            continue
        o2_lo, o2_hi = _to_float(r.get("o2_min")), _to_float(r.get("o2_max"))
        if min_o2 is not None and (o2_hi is None or o2_hi < min_o2):
            continue
        if max_o2 is not None and (o2_lo is None or o2_lo > max_o2):
            continue
        score = sum(w in hay for w in words)
        if words and score == 0:
            continue
        out.append((score, r))
    out.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in out[:limit]]


def _mock_predict(material: str, o2_percent: float, pressure_kpa: float,
                  airflow_cm_s: float, gravity_g: float) -> dict:
    """Mock: KHÔNG phải mô hình khoa học, chỉ để thử luồng. Module 5 sẽ thay thế."""
    return {
        "is_mock": True,
        "model": "mock-placeholder",
        "flammable_probability": None,
        "flame_spread_mm_s": None,
        "confidence_interval": None,
        "in_domain": False,
        "nearest_runs": [],
        "note": "Module 5 model not available yet. Placeholder result for pipeline testing only; no scientific value.",
        "inputs": {"material": material, "o2_percent": o2_percent, "pressure_kpa": pressure_kpa,
                   "airflow_cm_s": airflow_cm_s, "gravity_g": gravity_g},
    }


def _resolve_predict() -> Callable[..., dict]:
    if not config.PREDICT_IMPORT:
        return _mock_predict
    mod_name, _, fn_name = config.PREDICT_IMPORT.partition(":")
    return getattr(importlib.import_module(mod_name), fn_name)


def predict(material: str, o2_percent: float, pressure_kpa: float = 101.3,
            airflow_cm_s: float = 0.0, gravity_g: float = 0.0) -> dict:
    """Gọi predict() của Module 5. Hợp đồng dự kiến: trả dict có giá trị dự đoán,
    khoảng tin cậy, cờ in_domain và các thí nghiệm gần nhất."""
    result = _resolve_predict()(material=material, o2_percent=o2_percent, pressure_kpa=pressure_kpa,
                                airflow_cm_s=airflow_cm_s, gravity_g=gravity_g)
    result.setdefault("is_mock", False)
    return result


# ---------------- So sánh nghiên cứu (bảng) ----------------
# Thuộc tính hiển thị trong bảng, theo thứ tự. Thuộc tính rỗng ở mọi nghiên cứu sẽ bị ẩn.
COMPARE_ATTRIBUTES = [
    ("Acronym", "acronym"), ("Title", "title"), ("Sub-area", "sub_area"), ("Type", "project_type"),
    ("Platform", "platform"), ("Hardware", "hardware"), ("Fuel type", "fuel_type"), ("Material", "material"),
    ("O₂ range (%)", "o2_range"), ("Gravity", "gravity"), ("Period", "period"),
    ("Principal investigators", "pis"), ("Keywords", "keywords"), ("Publications listed", "n_publications"),
]
_SUFFIX = re.compile(r"-(?:i{1,3}|iv|\d+|r)$", re.I)


def _multi(v: str) -> list[str]:
    return [x.strip() for x in re.split(r"\s{3,}", v or "") if x.strip()]


def _pis(p: dict) -> str:
    firsts, lasts = (p.get("First Name") or "").split(), (p.get("Last Name") or "").split()
    # số tên/họ không khớp (tên có khoảng trắng) -> chỉ liệt kê họ, ngăn cách bằng dấu phẩy
    names = [f"{f} {l}" for f, l in zip(firsts, lasts)] if len(firsts) == len(lasts) else lasts
    return ", ".join(names[:3]) + (" et al." if len(names) > 3 else "")


def psi_records() -> list[dict]:
    """Bản ghi chuẩn hóa cho mọi nghiên cứu: ưu tiên metadata PSI đầy đủ, nếu không có thì dùng bảng investigations."""
    if config.PSI_METADATA_FILE.exists():
        hits = json.loads(config.PSI_METADATA_FILE.read_text(encoding="utf-8"))["hits"]["hits"]
        conditions = catalog_conditions()
        out = []
        for h in hits:
            s = h["_source"]
            hw = s.get("Experiment Hardware") or {}
            start, end = (s.get("Investigation Start Date") or "")[-4:], (s.get("Investigation End Date") or "")[-4:]
            cond = conditions.get(s["Accession"], {})
            out.append({
                "fuel_type": cond.get("fuel_type", ""), "material": cond.get("material", ""),
                "o2_range": cond.get("o2_range", ""), "gravity": cond.get("gravity", ""),
                "psi_id": s["Accession"], "acronym": s.get("Acronym") or "", "title": s.get("Title") or "",
                "sub_area": s.get("SubResearch Area") or "", "project_type": s.get("Project Type") or "",
                "platform": s.get("Flight Platform") or "",
                "hardware": re.sub(r"\s{2,}", "; ", hw.get("Name", "") if isinstance(hw, dict) else str(hw)),
                "period": f"{start}–{end}" if start or end else "", "pis": _pis(s.get("Person") or {}),
                "keywords": ", ".join(_multi(s.get("Keywords", ""))[:6]),
                "n_publications": str(len(_multi(s.get("Publication Title", "")))),
                "objective": re.sub(r"\s+", " ", s.get("Objectives") or "")[:400],
                "link": f"https://psi.nasa.gov/physci/repo/data/investigations/{s['Accession']}", "is_mock": False,
            })
        return out
    out = []
    for r in load_investigations():
        lo, hi = r.get("o2_min"), r.get("o2_max")
        out.append({
            "psi_id": str(r.get("psi_id", "")), "acronym": r.get("acronym") or "", "title": r.get("name") or "",
            "sub_area": r.get("sub_area") or "", "project_type": r.get("project_type") or "",
            "hardware": r.get("hardware") or "", "fuel_type": r.get("fuel_type") or "",
            "material": r.get("material") or "", "o2_range": f"{lo}–{hi}" if lo not in (None, "") else "",
            "gravity": r.get("gravity") or "", "keywords": r.get("keywords") or "",
            "objective": str(r.get("description") or "")[:400], "link": r.get("link") or "",
            "is_mock": bool(r.get("is_mock")),
        })
    return out


def _aliases(rec: dict) -> tuple[set[str], set[str]]:
    """(tên chính xác, tên họ/family). 'SAFFIRE-II' -> chính xác {'saffire-ii'}, family {'saffire'}."""
    exact = {rec["psi_id"].lower()}
    fam = set()
    # "DAFT / DAFT-2" (có khoảng trắng quanh "/") là 2 tên; "ACME/Flame Design" là 1 tên thuộc họ ACME
    for part in re.split(r"\s+/\s+", rec.get("acronym") or ""):
        part = part.strip().lower()
        if not part:
            continue
        exact.add(part)
        head = re.split(r"[/\s]", part)[0]
        fam.add(_SUFFIX.sub("", head))
    return exact, fam


def resolve_investigations(names: list[str]) -> tuple[list[dict], list[str]]:
    """Tên -> bản ghi. Khớp chính xác (mã PSI / acronym) trước; không có thì khớp theo family ('saffire' -> I, II, III)."""
    recs = psi_records()
    found: dict[str, dict] = {}
    unresolved = []
    for name in names:
        key = name.strip().lower()
        hit = [r for r in recs if key in _aliases(r)[0]] or [r for r in recs if key in _aliases(r)[1]]
        if not hit:
            unresolved.append(name)
        for r in hit:
            found.setdefault(r["psi_id"], r)
    ordered = sorted(found.values(), key=lambda r: int(re.sub(r"\D", "", r["psi_id"]) or 0))
    return ordered[:6], unresolved


def detect_investigation_names(question: str) -> list[str]:
    """Tìm tên nghiên cứu nhắc tới trong câu hỏi (dùng cho chế độ offline).
    Tên ngắn trùng từ tiếng Anh thông thường (SAME, FLEX, BASS) chỉ khớp khi viết HOA."""
    found = []
    for rec in psi_records():
        exact, fam = _aliases(rec)
        for alias in exact | fam:
            if alias.startswith("psi-") or len(alias) < 3:
                continue
            ms = [m.group(0) for m in re.finditer(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", question, re.I)]
            if not ms or (len(alias) <= 5 and not any(x.isupper() for x in ms)):
                continue
            found.append(alias)
    for m in re.finditer(r"\bPSI-\d+\b", question, re.I):
        found.append(m.group(0))
    return list(dict.fromkeys(found))
