"""Scenario ranking: which PSI investigations matter most for a crewed environment?

Answers the challenge's first objective: "Identify investigations most relevant to the fire safety needs
of habitable crew environments, including spacecraft, space stations, bases on the lunar and Martian
surfaces, and pressurized rovers."

Module 4 (Fire Risk Insights) owns the real rank(). Set RANK_IMPORT="package.module:function" in .env
to use it. Contract:

    rank(scenario: str, need: str | None = None, top_k: int = 5) -> list[dict]
      scenario  "spacecraft" | "moon_base" | "mars_base" | "rover"
      need      optional "prevention" | "detection" | "suppression"
      each row  {"psi_id": "PSI-26", "score": 0-100, "reasons": ["..."], ...any extra fields}

Until then a transparent built-in formula is used (is_placeholder=True, shown to users). Every score is
a weighted sum of keyword evidence found in the PSI metadata and PSI pages, and every matched keyword is
returned as a reason, so the ranking can be checked by hand.
"""
from __future__ import annotations

import importlib
import re

from . import config

CHALLENGE_URL = "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"
_GAP = ("there is currently no partial-gravity combustion data available in PSI. We expect such data will "
        "be added in the future, for example from the Lunar-g Combustion Investigation (LUCI) and the "
        "Flammability of Materials on the Moon (FM2) experiment.")

_O2 = r"oxygen[- ]enriched|elevated oxygen|enriched oxygen|(?:[3-9]\d|100)\s*%\s*(?:o2|o₂|oxygen)|oxygen (?:mole fraction|concentration|percentage)s?|limiting oxygen|maximum oxygen concentration|\bmoc\b|\bloi\b|o2 (?:concentration|level)s?"
_PRESSURE = r"\d+(?:\.\d+)?\s*(?:-|–|to)?\s*\d*(?:\.\d+)?\s*(?:atm|kpa|psia)\b|reduced pressure|low pressure|sub-?atmospheric|ambient pressure|pressure (?:range|of|between|from|up to|levels?)"

# Cabin conditions are quoted verbatim from the NASA Space Apps 2026 challenge statement (source of record).
SCENARIOS: dict[str, dict] = {
    "spacecraft": {
        "label": "Spacecraft / space station (ISS-like, microgravity)",
        "aliases": r"spacecraft|space ?station|\biss\b|orbit|capsule|cabin|crew module|tàu vũ trụ|trạm",
        "conditions": ("Compared to Earth, flames in free fall (i.e., in microgravity) are often dramatically "
                       "different because of the absence of buoyancy and thus rising hot gases. ... Flammability "
                       "is highly dependent on oxygen concentration, and air flow is also important in microgravity."),
        "focus": {"airflow / ventilation": r"ventilat|air ?flow|forced flow|flow velocity|opposed flow|concurrent flow|flow speed",
                  "microgravity flight data": r"microgravity|low[- ]gravity|\biss\b|international space station|cygnus",
                  "smoke & detection": r"smoke|aerosol|detect|particulate"},
        "gravity_note": "Microgravity data apply directly.",
    },
    "moon_base": {
        "label": "Moon Base (lunar surface, 0.16 g)",
        "aliases": r"moon|lunar|mặt trăng",
        "conditions": ("To reduce the pre-breathing duration and thus facilitate lunar excursions, it is expected "
                       "that the Moon Base and pressurized rover(s) will be at a pressure and oxygen concentration "
                       "between those in a spacesuit and the Earth's atmosphere. The intermediate oxygen "
                       "concentration used on the Moon will likely be 30% or greater, with a corresponding pressure "
                       "of 10.2 psi or less. ... " + _GAP),
        "focus": {"elevated oxygen": _O2,
                  "reduced pressure": _PRESSURE,
                  "flammability limits": r"flammab|extinction limit|ignition limit|flammability limit|limiting"},
        "gravity_note": "No partial-gravity data in PSI: microgravity and 1 g results can only bound 0.16 g.",
    },
    "mars_base": {
        "label": "Mars Base (Martian surface, 0.38 g)",
        "aliases": r"mars|martian|sao hỏa",
        "conditions": ("Although NASA is heavily focused on the return of astronauts to the Moon's surface and the "
                       "establishment of a Moon Base in preparation for the future human exploration of Mars, "
                       + _GAP + " (The challenge statement gives no Mars cabin atmosphere; the Moon-base "
                       "elevated-O2 / reduced-pressure assumption is used as a labelled proxy.)"),
        "focus": {"elevated oxygen": _O2,
                  "reduced pressure": _PRESSURE,
                  "flammability limits": r"flammab|extinction limit|ignition limit|flammability limit|limiting"},
        "gravity_note": "No partial-gravity data in PSI: microgravity and 1 g results can only bound 0.38 g; "
                        "Mars cabin conditions are an assumption (Moon-base proxy).",
    },
    "rover": {
        "label": "Pressurized rover (lunar surface)",
        "aliases": r"rover|xe tự hành",
        "conditions": ("To facilitate spacesuit use, an atmosphere with increased oxygen and reduced pressure "
                       "compared to Earth's is expected within the planned Moon Base and pressurized rovers. ... "
                       "The intermediate oxygen concentration used on the Moon will likely be 30% or greater, with "
                       "a corresponding pressure of 10.2 psi or less."),
        "focus": {"elevated oxygen": _O2,
                  "reduced pressure": _PRESSURE,
                  "small enclosed volume / airflow": r"ventilat|air ?flow|forced flow|flow velocity|enclos|confined|duct"},
        "gravity_note": "No partial-gravity data in PSI: microgravity and 1 g results can only bound 0.16 g.",
    },
}

NEEDS = {
    "prevention": r"flammab\w*|ignit\w*|flame spread|spread rate|extinction limit|flammability limit|material selection",
    "detection": r"smoke|aerosol|detect\w*|particulate|sensor|particle size",
    "suppression": r"extinguish\w*|suppress\w*|inert gas|\bco2\b|helium|\bsf6\b|water mist|extinguishing agent",
}
CABIN_MATERIALS = r"cotton|fabric|sibal|nomex|pmma|acrylic|plexiglas|plastic|silicone|ultem|polymer|solid fuel|textile|foam|wire insulation|fiberglass"
WEIGHTS = {"fire_safety": 0.30, "scenario_conditions": 0.30, "cabin_materials": 0.20, "safety_needs": 0.20}
WEIGHTS_WITH_NEED = {"fire_safety": 0.25, "scenario_conditions": 0.25, "cabin_materials": 0.10, "safety_needs": 0.40}


def resolve_scenario(text: str | None) -> str | None:
    t = (text or "").lower().replace(" ", "_")
    if t in SCENARIOS:
        return t
    for key, s in SCENARIOS.items():
        if re.search(s["aliases"], (text or "").lower()):
            return key
    return None


def _hits(pattern: str, text: str) -> list[str]:
    return sorted({re.sub(r"\s+", " ", m.group(0).strip().lower()) for m in re.finditer(pattern, text, re.I)})


def _graded(hits: list[str], full: int) -> float:
    """0 hit = 0, tăng dần theo số bằng chứng khác nhau, bão hòa ở `full` hit."""
    return min(len(hits), full) / full


def builtin_rank(records: list[dict], doc_texts: dict[str, str], scenario: str, need: str | None = None,
                 top_k: int = 5) -> list[dict]:
    """Transparent placeholder formula (see module docstring). records = PSI metadata rows.

    relevance score (0-100) = Σ weight × component, each component in [0, 1]:
      fire_safety          1 if PSI sub-area is Spacecraft Fire Safety, else graded fire-safety terms (≤0.5)
      scenario_conditions  mean over the scenario's focus factors of graded evidence (3 distinct hits = full)
      cabin_materials      graded cabin-type solid materials (3 distinct = full)
      safety_needs         graded evidence for the requested need (3 = full), or coverage of
                           prevention / detection / suppression when no need is given
    evidence_depth (publications listed in PSI) is reported separately and NOT part of the score."""
    sc = SCENARIOS[scenario]
    weights = WEIGHTS_WITH_NEED if need in NEEDS else WEIGHTS
    rows = []
    for r in records:
        meta = " ".join(str(r.get(k) or "") for k in ("title", "acronym", "keywords", "objective", "sub_area", "hardware"))
        text = f"{meta}\n{doc_texts.get(r['psi_id'], '')}"
        comp, why = {}, []

        fs = "spacecraft fire safety" in str(r.get("sub_area", "")).lower()
        fs_hits = _hits(r"fire safety|spacecraft fire|flammab\w*|fire hazard", text)
        comp["fire_safety"] = 1.0 if fs else 0.5 * _graded(fs_hits, 3)
        why.append("sub-area Spacecraft Fire Safety" if fs else
                   (f"fire-safety terms: {', '.join(fs_hits[:3])}" if fs_hits else "fundamental combustion study"))

        found = {name: _hits(pat, text) for name, pat in sc["focus"].items()}
        comp["scenario_conditions"] = sum(_graded(h, 3) for h in found.values()) / len(found)
        why += [f"{name}: {', '.join(h[:3])}" for name, h in found.items() if h]

        mats = _hits(CABIN_MATERIALS, text)
        comp["cabin_materials"] = _graded(mats, 3)
        if mats:
            why.append(f"materials: {', '.join(mats[:3])}")

        if need in NEEDS:
            h = _hits(NEEDS[need], text)
            comp["safety_needs"] = _graded(h, 3)
            if h:
                why.append(f"{need}: {', '.join(h[:3])}")
        else:
            cov = {n: _hits(p, text) for n, p in NEEDS.items()}
            comp["safety_needs"] = sum(_graded(h, 2) for h in cov.values()) / 3
            covered = [n for n, h in cov.items() if h]
            if covered:
                why.append(f"covers {', '.join(covered)}")

        score = round(100 * sum(weights[k] * v for k, v in comp.items()), 1)
        try:
            npub = int(r.get("n_publications") or 0)
        except (TypeError, ValueError):
            npub = 0
        rows.append({"psi_id": r["psi_id"], "acronym": r.get("acronym") or "", "title": r.get("title", ""),
                     "score": score, "components": {k: round(v, 2) for k, v in comp.items()},
                     "evidence_depth": npub, "reasons": why})
    rows.sort(key=lambda x: (-x["score"], -x["evidence_depth"], x["psi_id"]))
    return rows[:top_k]


def _external():
    if not config.RANK_IMPORT:
        return None
    mod, _, fn = config.RANK_IMPORT.partition(":")
    return getattr(importlib.import_module(mod), fn)


def rank(records: list[dict], doc_texts: dict[str, str], scenario: str, need: str | None = None,
         top_k: int = 5) -> dict:
    """Ranking with Module 4's rank() if configured, else the built-in placeholder formula."""
    top_k = max(1, min(int(top_k or 5), 10))
    ext = _external()
    if ext is not None:
        rows = ext(scenario=scenario, need=need, top_k=top_k)
        by_id = {r["psi_id"]: r for r in records}
        for x in rows:
            meta = by_id.get(x["psi_id"], {})
            x.setdefault("acronym", meta.get("acronym", ""))
            x.setdefault("title", meta.get("title", ""))
        return {"provider": config.RANK_IMPORT, "is_placeholder": False, "rows": rows}
    return {"provider": "built-in transparent formula (placeholder until Module 4 rank() is connected)",
            "is_placeholder": True, "weights": WEIGHTS_WITH_NEED if need in NEEDS else WEIGHTS, "rows": builtin_rank(records, doc_texts, scenario, need, top_k)}
