"""Mở rộng knowledge graph của nhóm (apps/web/public/data/graph.json) với thiết bị, vật liệu và sự cố lịch sử.

  python scripts/build_graph_extension.py            # -> data/graph_extension.json
  python scripts/build_graph_extension.py --graph <đường dẫn graph.json của nhóm>

Cùng schema với graph.json (nodes {id, type, label, url, ...}, edges {id, source, target, type, evidence, url}),
nên có thể gộp thẳng: nodes/edges mới dùng lại id của graph gốc (PSI-69, fuel:pmma, concept:oxygen...).

Quy tắc bằng chứng (giống graph gốc): một cạnh chỉ được tạo khi MỘT CÂU trong tài liệu NASA của corpus
(data/processed/chunks.jsonl) nhắc tới cả hai đầu. Câu đó là `evidence`, kèm `url` (mở đúng trang PDF nếu có)
và `chunk` (id đoạn văn, để chatbot trích dẫn [S#]).

Loại nút mới:   hardware, incident, material (vật liệu chưa có trong graph gốc; vật liệu đã có thì dùng fuel:<id>)
Loại cạnh mới:
  uses_hardware   investigation -> hardware     dòng "Hardware:" / "Flight platform:" trên trang PSI
  relates_to_hardware  investigation -> hardware   câu khác trên trang PSI (vd SAME nghiên cứu phản ứng của smoke detector)
  involved        incident -> material / hardware / concept   câu trong bài NASA về sự cố
  discussed_in    incident -> investigation     câu nhắc sự cố trong trang PSI / bài báo liên quan nghiên cứu
  co_studied      hardware -> material          câu trong trang PSI nhắc cả thiết bị và vật liệu (cùng nghiên cứu)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from assistant.retriever import load_chunks  # noqa: E402

DEFAULT_GRAPH = ROOT.parent / "nasa-app-challenge" / "apps" / "web" / "public" / "data" / "graph.json"
REPO_GRAPH = ROOT.parent / "web" / "public" / "data" / "graph.json"  # khi chạy trong repo: apps/assistant -> apps/web
OUT = ROOT / "data" / "graph_extension.json"

# (id, label, pattern). Vật liệu đã có trong graph gốc dùng lại id fuel:<...>.
MATERIALS = (
    ("fuel:pmma", "PMMA", r"\bpmma\b|acrylic|plexiglas"),
    ("fuel:nomex", "Nomex", r"nomex"),
    ("fuel:sibal-cotton-fiberglass", "SIBAL (cotton-fiberglass)", r"\bsibal\b|cotton[- ]fiberglass"),
    ("fuel:ultem", "Ultem", r"ultem"),
    ("fuel:silicone", "Silicone", r"silicone"),
    ("fuel:kapton", "Kapton", r"kapton|polyimide"),
    ("fuel:teflon", "Teflon", r"teflon|\bptfe\b|\bfep\b"),
    ("material:nylon", "Nylon", r"\bnylon"),
    ("material:cotton", "Cotton fabric", r"\bcotton\b(?![- ]fiberglass)"),
    ("material:paper", "Paper / cellulose", r"filter paper|\bpaper\b|cellulose|kimwipe"),
    ("material:polyethylene", "Polyethylene", r"polyethylene"),
    # không dùng "foam" trơn: "foam from a fire extinguisher" (Mir) là chất chữa cháy, không phải vật liệu
    ("material:polyurethane-foam", "Polyurethane foam", r"polyurethane|foam insulation|foam cushion"),
    ("material:wire-insulation", "Electrical wiring / wire insulation",
     r"wire insulation|insulated wire|wiring insulation|wire bundle|electrical wiring|\bwires\b"),
    ("material:lithium-perchlorate", "Lithium perchlorate (oxygen candle)", r"lithium perchlorate"),
)
HARDWARE = (
    ("hardware:cir", "Combustion Integrated Rack (CIR)", r"combustion integrated rack|\bcir\b"),
    ("hardware:msg", "Microgravity Science Glovebox (MSG)", r"microgravity science glovebox|\bmsg\b"),
    ("hardware:mdca", "Multi-user Droplet Combustion Apparatus (MDCA)", r"\bmdca\b|multi-user droplet combustion"),
    ("hardware:cygnus", "Cygnus cargo vehicle", r"cygnus"),
    ("hardware:p-trak", "TSI P-Trak particle counter", r"p-trak"),
    ("hardware:csa-cp", "Compound Specific Analyzer-Combustion Products (CSA-CP)", r"csa-cp|compound specific analy[sz]er"),
    ("hardware:pfe", "Portable fire extinguisher (PFE)", r"portable fire extinguisher|\bpfes?\b|fire extinguishers?"),
    ("hardware:smoke-detector", "Smoke detector", r"smoke detectors?"),
    ("hardware:oxygen-candle", "Solid-fuel oxygen generator (oxygen candle)", r"oxygen candle|solid[- ]fuel oxygen generator|\bsfog\b|oxygen[- ]generating (?:system|canister|cartridge)"),
    ("hardware:elektron", "Elektron oxygen generator", r"elektron"),
    ("hardware:oxygen-tank", "Oxygen tank", r"oxygen tank"),
    ("hardware:drop-tower", "Drop tower", r"drop tower|zero gravity research facility"),
    ("hardware:parabolic-aircraft", "Reduced-gravity aircraft (parabolic flight)", r"parabolic flight|parabolic trajector|kc-135|reduced[- ]gravity aircraft|zero-g aircraft"),
    ("hardware:sounding-rocket", "Sounding rocket", r"sounding rocket"),
    ("hardware:space-shuttle", "Space Shuttle", r"space shuttle|shuttle middeck|orbiter middeck"),
)
INCIDENTS = (
    ("incident:apollo-1", "Apollo 1 cabin fire (1967)", r"apollo[ -]?(?:1|204)\b(?![0-9])|as-204", "NASA-APOLLO-1", 1967),
    ("incident:apollo-13", "Apollo 13 oxygen tank explosion (1970)", r"apollo[ -]?13\b", "NASA-APOLLO-13", 1970),
    # "Mir" một mình là tên trạm (vd thí nghiệm PMMA trên Mir), không phải vụ cháy -> cần "fire"/"1997" cùng câu
    ("incident:mir-1997", "Mir oxygen-generator fire (1997)",
     r"\bmir\b[^.]*\b(?:fire|1997)\b|\b(?:fire|1997)\b[^.]*\bmir\b", "NASA-MIR-1997", 1997),
)
# Nền tảng nghiên cứu: không nối với sự cố (bài Mir nhắc tàu con thoi chở phi hành gia tới, không liên quan vụ cháy)
PLATFORMS = {"hardware:space-shuttle", "hardware:drop-tower", "hardware:parabolic-aircraft",
             "hardware:sounding-rocket", "hardware:cygnus", "hardware:cir", "hardware:msg"}
# Khái niệm của graph gốc mà bài về sự cố hay nhắc (id của graph gốc)
CONCEPTS = (
    ("concept:oxygen", r"pure oxygen|100(?:\s*%| percent) oxygen|oxygen[- ]rich|oxygen[- ]enriched|oxygen atmosphere"),
    ("concept:smoke", r"\bsmoke|\bsoot"),
    ("concept:suppression", r"extinguish|suppress"),
    ("concept:fire-detection", r"detect"),
    ("concept:flammability", r"flammab"),
    ("concept:ignition", r"ignit|spark|short circuit"),
)
_STRONG = re.compile(r"explo|blew up|fire|ignit|damag|fail|burn|rupture|arc(?:ing)?\b", re.I)
_META_LINE = re.compile(r"^-?\s*(?:hardware|flight platform)\s*:", re.I)  # dòng metadata của trang PSI
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])|\n+")


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text) if 25 <= len(s.strip()) <= 600]


def related_psis(c) -> list[str]:
    """Nghiên cứu PSI mà đoạn văn thuộc về: trang PSI-xx, hoặc 'related: PSI-xx' trong tên bài NTRS/OA."""
    if c.source_id.startswith("PSI-"):
        return [c.source_id]
    m = re.search(r"related: ([^\]]+)\]", c.title)
    return sorted(set(re.findall(r"PSI-\d+", m.group(1)))) if m else []


def short(s: str, n: int = 260) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", type=Path, default=REPO_GRAPH if REPO_GRAPH.exists() else DEFAULT_GRAPH)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    base = json.loads(args.graph.read_text(encoding="utf-8")) if args.graph.exists() else {"nodes": [], "edges": []}
    base_ids = {n["id"] for n in base["nodes"]}
    investigations = {n["id"] for n in base["nodes"] if n.get("type") == "investigation"}
    chunks = load_chunks()

    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}

    def node(nid: str, **fields) -> None:
        if nid not in base_ids:
            nodes.setdefault(nid, {"id": nid, **fields})

    def edge(src: str, dst: str, kind: str, sent: str, c) -> None:
        eid = f"{src}|{kind}|{dst}"
        if src == dst:
            return
        # đã có cạnh: chỉ thay bằng câu "mạnh" hơn (nhắc nổ/cháy/hư hỏng) nếu câu cũ không có
        if eid in edges and not (_STRONG.search(sent) and not _STRONG.search(edges[eid]["evidence"].split("“", 1)[-1])):
            return
        edges[eid] = {"id": eid, "source": src, "target": dst, "type": kind,
                      "evidence": f"{c.title.split(' [')[0][:90]}: “{short(sent)}”",
                      "url": c.page_url or c.url, "chunk": c.id}

    mats = [(i, l, re.compile(p, re.I)) for i, l, p in MATERIALS]
    hws = [(i, l, re.compile(p, re.I)) for i, l, p in HARDWARE]
    incs = [(i, l, re.compile(p, re.I), src, y) for i, l, p, src, y in INCIDENTS]
    cons = [(i, re.compile(p, re.I)) for i, p in CONCEPTS]
    inc_source = {src: i for i, _, _, src, _ in incs}
    by_source = {c.source_id: c for c in chunks}

    for iid, label, _, src, year in incs:
        c0 = by_source.get(src)
        node(iid, type="incident", label=label, year=year, url=c0.url if c0 else "", group="history")

    for c in chunks:
        psis = [p for p in related_psis(c) if p in investigations]
        own_psi = c.source_id if c.source_id in investigations else None
        incident_doc = inc_source.get(c.source_id)
        for s in sentences(c.text):
            hw_hits = [(i, l) for i, l, p in hws if p.search(s)]
            mat_hits = [(i, l) for i, l, p in mats if p.search(s)]
            if incident_doc:  # câu trong bài về sự cố: sự cố -> vật liệu / thiết bị / khái niệm
                for i, l in hw_hits:
                    if i in PLATFORMS:
                        continue
                    node(i, type="hardware", label=l, group="hardware")
                    edge(incident_doc, i, "involved", s, c)
                for i, l in mat_hits:
                    node(i, type="material", label=l, group="material")
                    edge(incident_doc, i, "involved", s, c)
                for i, p in cons:
                    if p.search(s) and i in base_ids:
                        edge(incident_doc, i, "involved", s, c)
                continue
            if own_psi:  # câu trong trang PSI của nghiên cứu: nghiên cứu -> thiết bị, thiết bị <-> vật liệu
                for i, l in hw_hits:
                    node(i, type="hardware", label=l, group="hardware")
                    edge(own_psi, i, "uses_hardware" if _META_LINE.search(s) else "relates_to_hardware", s, c)
                    for m, ml in mat_hits:
                        node(m, type="material", label=ml, group="material")
                        edge(i, m, "co_studied", s, c)
            for iid, _, p, _, _ in incs:  # sự cố được nhắc trong tài liệu của một nghiên cứu
                if p.search(s):
                    for psi in psis:
                        edge(iid, psi, "discussed_in", s, c)

    # cùng cặp đã có uses_hardware -> bỏ relates_to_hardware (thừa)
    for eid in [k for k, e in edges.items() if e["type"] == "relates_to_hardware"]:
        e = edges[eid]
        if f"{e['source']}|uses_hardware|{e['target']}" in edges:
            del edges[eid]
    used = {e["source"] for e in edges.values()} | {e["target"] for e in edges.values()}
    out_nodes = [n for n in nodes.values() if n["id"] in used or n["type"] == "incident"]
    ext = {
        "schema_version": 1,
        "extends": "apps/web/public/data/graph.json",
        "built_from": "apps/assistant/data/processed/chunks.jsonl (NASA PSI pages, NTRS papers, NASA history pages)",
        "nodes": out_nodes,
        "edges": list(edges.values()),
        "node_types": {"hardware": "flight or ground hardware", "incident": "historical spacecraft fire / oxygen incident",
                       "material": "cabin material not already a fuel node in graph.json"},
        "edge_types": {"uses_hardware": "investigation -> hardware (PSI 'Hardware' / 'Flight platform' line)",
                       "relates_to_hardware": "investigation -> hardware (other PSI record sentence, e.g. studies smoke detector response)",
                       "involved": "incident -> material / hardware / concept (NASA incident article sentence)",
                       "discussed_in": "incident -> investigation (sentence in the investigation's PSI page or related paper)",
                       "co_studied": "hardware -> material (same PSI sentence)"},
    }
    args.out.write_text(json.dumps(ext, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(f"graph gốc: {args.graph} ({len(base['nodes'])} nodes)")
    print("nodes mới:", dict(Counter(n["type"] for n in out_nodes)))
    print("edges mới:", dict(Counter(e["type"] for e in edges.values())))
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
