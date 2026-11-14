"""Mô hình dự đoán thời gian cháy của Module 5 (Nhi): ml_modelling/psi159_psi69_source_specific_burn_time_models.joblib.

Chatbot chỉ dùng mô hình FLEX (PSI-69: giọt n-heptane / methanol) vì đầu vào hiểu được với người dùng
(nhiên liệu, % O₂, áp suất, khí pha loãng, kích thước giọt). Mô hình PSI-159 (CFI-G) cần nhiệt độ đoạn nhiệt,
Zst, lưu lượng nhiên liệu… nên không đưa ra cho chatbot.

Phụ thuộc (tùy chọn): scikit-learn==1.6.1 (đúng phiên bản lúc train), joblib, pandas; xgboost nếu nạp cả PSI-159.
Thiếu thư viện / file -> available() = False và tool bị ẩn khỏi LLM (không bao giờ có dự đoán giả).
"""
from __future__ import annotations

import json
import warnings
from functools import lru_cache
from pathlib import Path

from . import config

MODEL_NAME = "psi159_psi69_source_specific_burn_time_models.joblib"
META_NAME = "psi159_psi69_source_specific_burn_time_metadata.json"
NOTEBOOK_URL = "https://github.com/w4ngg/nasa-app-challenge/blob/main/ml_modelling/psi159-psi69-burn-forecasting.ipynb"
FUELS = {"heptane": "heptane", "n-heptane": "heptane", "methanol": "methanol"}


def model_dir() -> Path | None:
    cands = [config.MODEL_DIR] if config.MODEL_DIR else []
    cands += [config.ROOT.parent.parent / "ml_modelling",                       # repo: apps/assistant -> ml_modelling
              config.ROOT.parent / "nasa-app-challenge" / "ml_modelling"]       # bản dev cạnh repo
    return next((Path(p) for p in cands if (Path(p) / MODEL_NAME).exists()), None)


@lru_cache(maxsize=1)
def _load():
    d = model_dir()
    if d is None:
        raise FileNotFoundError("model file not found")
    import joblib  # noqa: PLC0415
    import sklearn  # noqa: PLC0415
    if not sklearn.__version__.startswith("1.6"):
        raise RuntimeError(f"model needs scikit-learn 1.6.x (installed {sklearn.__version__})")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        bundle = joblib.load(d / MODEL_NAME)
    meta = json.loads((d / META_NAME).read_text(encoding="utf-8"))
    return bundle["models"]["PSI-69"], meta


@lru_cache(maxsize=1)
def available() -> bool:
    try:
        _load()
        return True
    except Exception:
        return False


@lru_cache(maxsize=1)
def training_ranges() -> dict:
    """Khoảng điều kiện trong bảng FLEX (dữ liệu train) để cảnh báo ngoài miền."""
    from .charts import table  # noqa: PLC0415
    tbs = table("PSI-69")
    if not tbs:
        return {}
    t = tbs[0]
    ix = {c: i for i, c in enumerate(t["columns"])}
    cols = {"o2_percent": ("O initial ambient composition; mole fraction", 100),
            "pressure_atm": ("Ambient pressure; mmHg", 1 / 760),
            "helium_percent": ("He initial ambient composition; mole fraction", 100),
            "co2_percent": ("CO initial ambient composition; mole fraction", 100),
            "droplet_diameter_mm": ("Droplet initial diameter; mm", 1)}
    out = {}
    for k, (c, f) in cols.items():
        vals = []
        for r in t["rows"]:
            try:
                vals.append(float(r[ix[c]]) * f)
            except (ValueError, TypeError, KeyError):
                pass
        if vals:
            out[k] = (round(min(vals), 2), round(max(vals), 2))
    return out


def predict(fuel: str, o2_percent: float, pressure_atm: float = 1.0, helium_percent: float = 0.0,
            co2_percent: float = 0.0, droplet_diameter_mm: float | None = None) -> dict:
    f = FUELS.get(str(fuel).strip().lower())
    if not f:
        return {"error": f"the FLEX model only knows n-heptane and methanol droplets, not {fuel!r}"}
    o2, he, co2 = float(o2_percent), float(helium_percent or 0), float(co2_percent or 0)
    if not 0 < o2 < 100 or o2 + he + co2 > 100:
        return {"error": "oxygen + helium + CO2 must be between 0 and 100 percent"}
    ranges = training_ranges()
    d = float(droplet_diameter_mm) if droplet_diameter_mm else None
    if d is None:
        d = 3.0  # diameter typical of FLEX; reported back so the user sees the assumption
    model, meta = _load()
    import pandas as pd  # noqa: PLC0415
    x = pd.DataFrame([{"flame_type": "Droplet", "fuel": f, "pressure_bar": float(pressure_atm) * 1.01325,
                       "o2_fraction": o2 / 100, "n2_fraction": (100 - o2 - he - co2) / 100, "co_fraction": co2 / 100,
                       "he_fraction": he / 100, "initial_droplet_diameter_mm": d}])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        y = float(model.predict(x)[0])
    info = meta["models"]["PSI-69"]
    radius = float(info["prediction_interval"]["radius_s"])
    inputs = {"o2_percent": o2, "pressure_atm": float(pressure_atm), "helium_percent": he, "co2_percent": co2,
              "droplet_diameter_mm": d}
    outside = [f"{k} = {v:g} (FLEX tested {ranges[k][0]:g}–{ranges[k][1]:g})" for k, v in inputs.items()
               if k in ranges and not ranges[k][0] <= v <= ranges[k][1]]
    return {
        "model": f"Module 5 FLEX burn-time model ({info['champion']}, {info['rows_used']} FLEX tests, "
                 f"validated with {info['prediction_interval']['validation']})",
        "fuel": f, "inputs": inputs, "assumed_droplet_diameter": droplet_diameter_mm in (None, 0, ""),
        "predicted_burn_time_s": round(y, 1),
        "interval_90_s": [round(max(0.0, y - radius), 1), round(y + radius, 1)],
        "meaning": info["prediction_meaning"],
        "out_of_training_range": outside,
        "limits": meta.get("known_limits", [])[:6],
    }
