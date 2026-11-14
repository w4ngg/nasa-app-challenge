"""Knowledge graph built from the catalog: hierarchy plus cross links, every edge with evidence.

Hierarchy: Resource -> Program -> Investigation -> Publication / Dataset.
Cross links: studies (investigation or publication -> scientific concept), uses_fuel,
related_to (between investigations). Concepts are matched with the curated CONCEPTS
dictionary against PSI text; each edge keeps the matched sentence so a reader can check it.
Findings are not built yet: they need full-text sources with page numbers.
"""
import re
from typing import Any

from .models import Catalog

PSI_HOME = "https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation"

# Scientific concepts: (id, label, pattern). Curated by hand from the PSI keyword list.
CONCEPTS: tuple[tuple[str, str, str], ...] = (
    ("flame-spread", "Flame spread", r"flame spread|spread rate|flame-spread"),
    ("smoke", "Smoke, soot and aerosols", r"\bsmoke|\bsoot|aerosol|particulate"),
    ("fire-detection", "Fire detection", r"fire detect|smoke detect|detection system|fire alarm"),
    ("suppression", "Fire suppression",
     r"fire suppress|suppressant|extinguishment|extinguishing agent|fire extinguish|suppression (?:system|of solids|of fire|effectiveness)"),
    ("extinction", "Flame extinction", r"extinction"),
    ("droplet", "Droplet combustion", r"droplet"),
    ("cool-flames", "Cool flames", r"cool flame|cool-flame"),
    ("diffusion-flames", "Diffusion flames", r"diffusion flame"),
    ("premixed", "Premixed flames", r"premixed"),
    ("flammability", "Material flammability", r"flammab"),
    # Not "ignited" / "igniter": every experiment lights its sample, few study ignition itself.
    ("ignition", "Ignition", r"ignition (?:delay|limit|temperature|behavio|characteristic|time|energy|of|and)|ignitab|auto-?ignition|low-temperature ignition"),
    ("smoldering", "Smoldering", r"smolder|smoulder"),
    ("buoyancy", "Buoyancy and gravity effects", r"buoyan"),
    ("radiation", "Radiative heat transfer", r"radiati"),
    ("kinetics", "Chemical kinetics", r"kinetic"),
    ("electric-field", "Electric-field effects", r"electric[- ]field|e-field"),
    ("airflow", "Airflow and ventilation", r"air ?flow|ventilat|concurrent[- ]flow|opposed[- ]flow|flow velocit"),
    ("oxygen", "Oxygen concentration", r"oxygen concentration|oxygen level|oxygen mole fraction|oxygen-enriched|elevated oxygen"),
    ("modeling", "Modeling and simulation", r"modell?ing|simulation|numerical|computational"),
    ("fire-safety", "Spacecraft fire safety", r"spacecraft fire|fire safety"),
    ("partial-gravity", "Lunar and Martian gravity", r"\blunar|martian|partial[- ]gravity"),
)
_COMPILED = [(cid, label, re.compile(p, re.I)) for cid, label, p in CONCEPTS]
INVESTIGATION_FIELDS = (("title", "PSI title"), ("objective", "PSI objectives"), ("approach", "PSI approach"),
                        ("hypothesis", "PSI hypothesis"), ("research_impacts", "PSI research impacts"))


def sentence_around(text: str, start: int, end: int, limit: int = 220) -> str:
    """The sentence containing a match, trimmed to `limit` characters around it."""
    left = max(text.rfind(". ", 0, start), text.rfind("\n", 0, start)) + 1
    right_candidates = [i for i in (text.find(". ", end), text.find("\n", end)) if i != -1]
    right = min(right_candidates) + 1 if right_candidates else len(text)
    snippet = " ".join(text[left:right].split())
    if len(snippet) > limit:
        mid = snippet.lower().find(text[start:end].lower().split()[0]) if text[start:end].strip() else 0
        lo = max(0, mid - limit // 2)
        snippet = ("…" if lo else "") + snippet[lo:lo + limit] + "…"
    return snippet


def build_graph(catalog: Catalog) -> dict[str, Any]:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def node(nid: str, **fields: Any) -> None:
        nodes.setdefault(nid, {"id": nid, **fields})

    def edge(source: str, target: str, kind: str, evidence: str, url: str) -> None:
        edges.append({"id": f"{source}|{kind}|{target}", "source": source, "target": target, "type": kind,
                      "evidence": evidence, "url": url})

    node("resource:psi", type="resource", label="NASA PSI Combustion Science", url=PSI_HOME)
    pubs = {p.id: p for p in catalog.publications}
    related_pairs: set[tuple[str, ...]] = set()
    tables = {}
    for t in catalog.tables:
        tables.setdefault(t.investigation_id, []).append(t)

    for inv in catalog.investigations:
        program = f"program:{inv.family or 'other'}"
        node(program, type="program", label=inv.family or "Other investigations", url=PSI_HOME)
        if not any(e["id"] == f"resource:psi|includes|{program}" for e in edges):
            edge("resource:psi", program, "includes",
                 "Programs grouped by the PSI investigation acronym" if inv.family else "Investigations without a program acronym on PSI",
                 PSI_HOME)
        c = inv.conditions
        node(inv.id, type="investigation", label=inv.acronym or inv.id, title=inv.title, url=inv.source_url,
             platform=inv.platform, fuels=c.fuels, fuel_categories=c.fuel_categories,
             o2=[o.model_dump() for o in c.o2], runs=c.run_count, hardware=inv.hardware_tags)
        edge(program, inv.id, "includes", inv.family_basis or "No program acronym listed on PSI", inv.source_url)

        for cid, label, pattern in _COMPILED:
            for field, field_label in INVESTIGATION_FIELDS:
                text = getattr(inv, field) or ""
                if m := pattern.search(text):
                    node(f"concept:{cid}", type="concept", group="phenomenon", label=label)
                    edge(inv.id, f"concept:{cid}", "studies", f"{field_label}: “{sentence_around(text, m.start(), m.end())}”", inv.source_url)
                    break

        for fuel in c.fuels:
            fid = "fuel:" + re.sub(r"[^a-z0-9]+", "-", fuel.lower()).strip("-")
            node(fid, type="concept", group="fuel", label=fuel, category=c.fuel_groups.get(fuel))
            columns = sorted({t.fuel_column for t in tables.get(inv.id, []) if t.fuel_column})
            edge(inv.id, fid, "uses_fuel",
                 f"{c.fuel_runs.get(fuel, 0)} experiment-table rows name it" + (f" (column “{columns[0]}”)" if columns else ""),
                 inv.source_url)

        for t in tables.get(inv.id, []):
            did = f"dataset:{t.file_name}"
            node(did, type="dataset", label=t.file_name.replace(f"{inv.id}_Experimental table_", "").removesuffix(".csv"),
                 title=t.file_name, rows=len(t.rows), columns=t.columns, fuel_column=t.fuel_column,
                 o2_column=t.o2_column, o2_basis=t.o2_basis, investigation=inv.id, url=inv.source_url)
            edge(inv.id, did, "has_dataset", f"Experiment table listed on the PSI record ({len(t.rows)} rows)", inv.source_url)

        for rid in inv.related_ids:
            # One undirected edge per pair, whichever side lists the other (PSI often lists it on one side only).
            pair = tuple(sorted((inv.id, rid)))
            if any(r.id == rid for r in catalog.investigations) and pair not in related_pairs:
                related_pairs.add(pair)
                edge(inv.id, rid, "related_to", f"{inv.id} lists {rid} as a related investigation on PSI", inv.source_url)

    for link in catalog.links:
        p = pubs[link.publication_id]
        url = f"https://doi.org/{p.doi}" if p.doi else nodes[link.investigation_id]["url"]
        node(p.id, type="publication", label=p.title if len(p.title) <= 60 else p.title[:57].rstrip() + "…",
             title=p.title, authors=p.authors, doi=p.doi, url=url)
        edge(link.investigation_id, p.id, "lists_publication",
             f"Entry {link.source_entry} in the PSI record's publication list", nodes[link.investigation_id]["url"])

    for p in catalog.publications:
        for cid, label, pattern in _COMPILED:
            if (m := pattern.search(p.title)) and f"concept:{cid}" in nodes:
                edge(p.id, f"concept:{cid}", "studies", f"Publication title: “{sentence_around(p.title, m.start(), m.end())}”",
                     f"https://doi.org/{p.doi}" if p.doi else PSI_HOME)

    seen, unique = set(), []
    for e in edges:  # one publication can be listed by several investigations; keep each edge once
        if e["id"] not in seen:
            seen.add(e["id"])
            unique.append(e)
    return {"schema_version": 1, "nodes": list(nodes.values()), "edges": unique,
            "not_built": ["finding"], "concepts": [{"id": f"concept:{c}", "label": l, "pattern": p} for c, l, p in CONCEPTS]}
