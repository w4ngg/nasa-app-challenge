"""Cầu nối sang Module 1 (search investigations) và Module 5 (predict).

Khi chưa có sản phẩm của các module kia, các hàm ở đây trả dữ liệu MOCK
(luôn có cờ `is_mock=True` để UI và câu trả lời ghi rõ).
"""
from __future__ import annotations

import csv
import importlib
import json
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


def load_investigations() -> list[dict]:
    if config.INVESTIGATIONS_FILE.exists():
        with open(config.INVESTIGATIONS_FILE, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for r in rows:
            r["is_mock"] = False
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
