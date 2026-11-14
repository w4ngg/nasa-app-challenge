"""Knowledge graph cho chatbot: graph của nhóm (Module 1 / Knowledge Map) + phần mở rộng của Module 3.

  graph gốc     apps/web/public/data/graph.json   nghiên cứu, chương trình, publication, khái niệm, nhiên liệu, dataset
  mở rộng       data/graph_extension.json         thiết bị, sự cố lịch sử, vật liệu (scripts/build_graph_extension.py)

Mọi cạnh có `evidence` (câu trích từ nguồn NASA) và `url`; cạnh của phần mở rộng có thêm `chunk` (id đoạn văn
trong corpus) để chatbot trích dẫn [S#]. Không có graph gốc -> chỉ dùng phần mở rộng.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from . import config

# Cạnh nhiều và ít thông tin: chỉ trả khi được hỏi đích danh (relation=...)
_BULKY = {"lists_publication", "has_dataset", "includes"}
_ALIASES = {  # tên gọi thường gặp -> id nút
    "apollo 1": "incident:apollo-1", "apollo-1": "incident:apollo-1", "as-204": "incident:apollo-1",
    "apollo 13": "incident:apollo-13", "apollo-13": "incident:apollo-13",
    "mir": "incident:mir-1997", "mir fire": "incident:mir-1997", "mir 1997": "incident:mir-1997",
    "oxygen candle": "hardware:oxygen-candle", "sfog": "hardware:oxygen-candle",
    "glovebox": "hardware:msg", "fire extinguisher": "hardware:pfe",
    "acrylic": "fuel:pmma", "plexiglas": "fuel:pmma", "cotton-fiberglass": "fuel:sibal-cotton-fiberglass",
}


def _base_candidates() -> list[Path]:
    root = config.ROOT
    return [p for p in (config.GRAPH_BASE_FILE,
                        root.parent / "web" / "public" / "data" / "graph.json",          # trong repo: apps/web
                        root.parent / "nasa-app-challenge" / "apps" / "web" / "public" / "data" / "graph.json",
                        root / "data" / "graph_base.json") if p]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


class KnowledgeGraph:
    def __init__(self, base: dict | None = None, extension: dict | None = None, base_path: str = ""):
        self.nodes: dict[str, dict] = {}
        self.out: dict[str, list[dict]] = defaultdict(list)
        self.inn: dict[str, list[dict]] = defaultdict(list)
        self.base_path = base_path
        self.n_base = len((base or {}).get("nodes", []))
        self.n_ext = len((extension or {}).get("nodes", []))
        for g in (base or {}, extension or {}):
            for n in g.get("nodes", []):
                self.nodes.setdefault(n["id"], n)
            for e in g.get("edges", []):
                if e["source"] in self.nodes and e["target"] in self.nodes:
                    self.out[e["source"]].append(e)
                    self.inn[e["target"]].append(e)

    @classmethod
    def load(cls) -> "KnowledgeGraph":
        base, path = None, ""
        for p in _base_candidates():
            if Path(p).exists():
                base, path = json.loads(Path(p).read_text(encoding="utf-8")), str(p)
                break
        ext_path = config.GRAPH_EXTENSION_FILE
        ext = json.loads(ext_path.read_text(encoding="utf-8")) if ext_path.exists() else None
        return cls(base, ext, path)

    @property
    def available(self) -> bool:
        return bool(self.nodes)

    def resolve(self, entity: str) -> list[str]:
        """id, PSI id, acronym, tên vật liệu/thiết bị/sự cố -> danh sách id nút (khớp nhất trước)."""
        q = (entity or "").strip()
        if not q:
            return []
        if q in self.nodes:
            return [q]
        nq = _norm(q)
        if nq in _ALIASES and _ALIASES[nq] in self.nodes:
            return [_ALIASES[nq]]
        m = re.fullmatch(r"psi[- ]?(\d+)", nq.replace(" ", "")) or re.fullmatch(r"psi (\d+)", nq)
        if m and f"PSI-{m.group(1)}" in self.nodes:
            return [f"PSI-{m.group(1)}"]
        exact, starts, contains = [], [], []
        for nid, n in self.nodes.items():
            if n.get("type") == "publication":
                continue
            names = [_norm(n.get("label", "")), _norm(nid.split(":", 1)[-1]), _norm(n.get("title", ""))]
            if nq in names:
                exact.append(nid)
            elif any(x.startswith(nq + " ") or x.startswith(nq + "(") for x in names if x):
                starts.append(nid)
            elif len(nq) >= 4 and any(nq in x for x in names if x):
                contains.append(nid)
        order = {"investigation": 0, "incident": 1, "hardware": 2, "material": 3, "concept": 4, "program": 5}
        rank = lambda i: order.get(self.nodes[i].get("type"), 9)  # noqa: E731
        return sorted(exact, key=rank) + sorted(starts, key=rank) + sorted(contains, key=rank)[:5]

    def neighbors(self, nid: str, relation: str | None = None, limit: int = 12) -> list[dict]:
        rows = [(e, e["target"], "out") for e in self.out.get(nid, [])] + \
               [(e, e["source"], "in") for e in self.inn.get(nid, [])]
        if relation:
            rows = [r for r in rows if r[0]["type"] == relation]
        else:
            rows = [r for r in rows if r[0]["type"] not in _BULKY]
        # thông tin nhiều trước: sự cố / thiết bị / vật liệu, rồi nghiên cứu, rồi khái niệm
        order = {"incident": 0, "hardware": 1, "material": 2, "investigation": 3, "concept": 4}
        rows.sort(key=lambda r: (order.get(self.nodes[r[1]].get("type"), 9), r[0]["type"], r[1]))
        return [{"relation": e["type"], "direction": d, "node": other, "label": self.nodes[other].get("label", other),
                 "type": self.nodes[other].get("type"), "evidence": e.get("evidence", ""), "url": e.get("url", ""),
                 "chunk": e.get("chunk")} for e, other, d in rows[:limit]]

    def relation_counts(self, nid: str) -> dict[str, int]:
        c: dict[str, int] = defaultdict(int)
        for e in self.out.get(nid, []) + self.inn.get(nid, []):
            c[e["type"]] += 1
        return dict(c)


_GRAPH: KnowledgeGraph | None = None


def get_graph() -> KnowledgeGraph:
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = KnowledgeGraph.load()
    return _GRAPH
