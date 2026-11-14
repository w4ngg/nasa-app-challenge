"""Truy xuất đoạn văn bằng BM25 (không cần thư viện ngoài).

Đây là bộ truy xuất tạm thời. Khi Module 1 có search() dùng chung, chỉ cần thay
`DocumentRetriever.search` bằng lời gọi sang Module 1, giữ nguyên kiểu trả về.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path

from . import config
from .schema import Chunk

_STOPWORDS = set("""
a an the and or of to in on for with by at from as is are was were be been being this that these those
it its into than then which what when where who how why do does did can could should would will may
""".split())


# Từ điển Việt -> Anh tối thiểu để chế độ offline (không có LLM dịch) vẫn tìm được tài liệu tiếng Anh.
# Bổ sung thêm khi gặp câu hỏi tìm không ra.
VI_EN_GLOSSARY = {
    "vi trọng lực": "microgravity", "không trọng lực": "microgravity", "trọng lực": "gravity",
    "ngọn lửa": "flame", "đám cháy": "fire", "cháy": "fire flame combustion burning", "bắt lửa": "flammability ignition",
    "dễ cháy": "flammability flammable", "lan truyền": "spread", "tốc độ": "rate velocity",
    "oxy": "oxygen", "nồng độ": "concentration", "áp suất": "pressure",
    "thông gió": "ventilation airflow", "quạt": "fan ventilation airflow", "luồng khí": "airflow flow",
    "vật liệu rắn": "solid fuel material", "vật liệu": "material", "nhiên liệu": "fuel",
    "chất lỏng": "liquid", "giọt": "droplet", "khí": "gas", "vải": "fabric cotton", "nhựa": "plastic pmma",
    "dập lửa": "suppression extinguish", "chữa cháy": "suppression extinguish", "dập tắt": "extinction suppression",
    "tắt": "extinction off", "khói": "smoke", "phát hiện": "detection detector", "cảm biến": "sensor detector",
    "khí trơ": "inert gas nitrogen", "hình cầu": "spherical", "đối lưu": "convection buoyancy",
    "tàu vũ trụ": "spacecraft cabin", "khoang": "cabin", "trạm vũ trụ": "space station iss",
    "mặt trăng": "moon lunar", "sao hỏa": "mars", "sự cố": "incident", "an toàn": "safety",
    "nghiên cứu": "study investigation", "thí nghiệm": "experiment investigation",
}


def expand_query(text: str) -> str:
    """Thêm từ khóa tiếng Anh cho các cụm tiếng Việt có trong câu hỏi (ưu tiên cụm dài)."""
    low = text.lower()
    extra = []
    for vi in sorted(VI_EN_GLOSSARY, key=len, reverse=True):
        if vi in low:
            extra.append(VI_EN_GLOSSARY[vi])
            low = low.replace(vi, " ")
    return f"{text} {' '.join(extra)}" if extra else text


def stem(t: str) -> str:
    """Stemmer tiếng Anh tối giản, bảo thủ: gộp số nhiều / -ing / -ed / e cuối.

    firefighters -> firefighter, investigators -> investigator, studies -> study, flames/flame -> flam,
    burning -> burn, measured/measure -> measur. Không đụng số, từ viết tắt có số/gạch (co2, bass-ii), từ <= 3 ký tự.
    """
    if len(t) <= 3 or not t.isalpha() or not t.isascii():
        return t
    if t.endswith("ies") and len(t) > 4:
        t = t[:-3] + "y"
    elif t.endswith("sses"):
        t = t[:-2]
    elif t.endswith("ing") and len(t) - 3 >= 4:
        t = t[:-3]
    elif t.endswith("ed") and not t.endswith("eed") and len(t) - 2 >= 4:
        t = t[:-2]
    elif t.endswith("s") and not t.endswith(("ss", "us", "is")):
        t = t[:-1]
    if t.endswith("e") and len(t) > 4:
        t = t[:-1]
    return t


def tokenize(text: str, do_stem: bool = True) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("o₂", "o2").replace("co₂", "co2")
    # [^\W_] giữ nguyên từ có dấu (vd "phở") thay vì cắt thành mảnh "ph" khớp nhầm tài liệu tiếng Anh
    toks = [t for t in re.findall(r"[^\W_]+(?:[.\-][^\W_]+)*", text) if len(t) > 1 and t not in _STOPWORDS]
    return [stem(t) for t in toks] if do_stem else toks


# Nhóm từ đồng nghĩa chuyên ngành (query expansion). Từ trong cùng nhóm được thêm vào truy vấn với trọng số
# SYNONYM_WEIGHT. Bổ sung khi gặp câu hỏi tìm không ra (xem recall test trong tests/).
SYNONYM_GROUPS = [
    ["firefighter", "fireman", "firemen", "firefighting"],
    ["extinguish", "extinguishment", "extinction", "suppression", "suppressant", "quench", "blowoff"],
    ["microgravity", "weightless", "weightlessness", "zero-g", "low-gravity"],
    ["spread", "propagation", "propagate"],
    ["ventilation", "ventilated", "airflow", "fan", "forced-flow"],
    ["smoke", "aerosol", "particulate"],
    ["detector", "detection", "sensor", "alarm"],
    ["flammability", "flammable", "ignitability", "combustibility", "combustible"],
    ["spacecraft", "cabin", "capsule"],
    ["moon", "lunar"], ["mars", "martian"],
    ["pmma", "acrylic", "plexiglass", "plexiglas"],
    ["fabric", "textile", "cloth"],
    ["droplet", "drop"],
    ["oxygen", "o2"],
    ["investigation", "experiment", "study"],
    ["apparatus", "hardware", "equipment", "facility"],
    ["clothing", "garment", "attire", "gear", "ensemble", "suit"],
    ["breathing", "respiratory"],
    ["tank", "cylinder", "bottle"],
]
SYNONYM_WEIGHT = 0.5
_SYN: dict[str, set[str]] = {}
for _g in SYNONYM_GROUPS:
    _stems = {stem(w) for w in _g}
    for _s in _stems:
        _SYN.setdefault(_s, set()).update(_stems - {_s})
_PHRASES = {"co2": ["carbon", "dioxid"], "sf6": ["sulfur", "hexafluorid"]}  # dạng đã stem


def query_terms(query: str, synonyms: bool = True) -> dict[str, float]:
    """Token truy vấn kèm trọng số: từ gốc 1.0, từ đồng nghĩa SYNONYM_WEIGHT."""
    terms: dict[str, float] = {}
    for t in tokenize(query):
        terms[t] = 1.0
    if synonyms:
        for t in list(terms):
            for s in _SYN.get(t, set()) | set(_PHRASES.get(t, ())):
                terms.setdefault(s, SYNONYM_WEIGHT)
    return terms


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(d) for d in docs]
        self.lens = [len(d) for d in docs]
        self.avgdl = (sum(self.lens) / len(self.lens)) if self.lens else 0.0
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: list[str] | dict[str, float]) -> list[float]:
        """query: list token (trọng số 1) hoặc dict token -> trọng số (từ đồng nghĩa có trọng số thấp hơn)."""
        weights = query if isinstance(query, dict) else {t: 1.0 for t in query}
        weights = {t: w for t, w in weights.items() if t in self.idf}
        out = []
        for tf, dl in zip(self.docs, self.lens):
            s = 0.0
            for t, w in weights.items():
                f = tf.get(t)
                if f:
                    s += w * self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
            out.append(s)
        return out


def load_chunks(path: Path | None = None) -> list[Chunk]:
    """Ưu tiên dữ liệu thật (data/processed/chunks.jsonl); nếu chưa có thì dùng MOCK."""
    if path is None:
        path = config.CHUNKS_FILE if config.CHUNKS_FILE.exists() else config.MOCK_CHUNKS_FILE
    chunks = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                chunks.append(Chunk.from_dict(json.loads(line)))
    return chunks


SECTION_WEIGHTS = {"Publications": 0.4}


class DocumentRetriever:
    def __init__(self, chunks: list[Chunk] | None = None):
        self.chunks = chunks if chunks is not None else load_chunks()
        self.bm25 = BM25([tokenize(f"{c.title} {c.section} {c.text}") for c in self.chunks])

    @property
    def uses_mock(self) -> bool:
        return any(c.is_mock for c in self.chunks)

    def search(self, query: str, k: int | None = None, min_score: float | None = None,
               source_id: str | None = None) -> list[tuple[Chunk, float]]:
        # đọc config lúc gọi (không phải lúc import) để chỉnh được khi đang chạy (demo UI)
        k = config.TOP_K if k is None else k
        min_score = config.MIN_SCORE if min_score is None else min_score
        scores = self.bm25.scores(query_terms(query))
        # Danh sách tên bài báo dày từ khóa nhưng ít nội dung giải thích -> giảm trọng số
        scores = [s * SECTION_WEIGHTS.get(c.section, 1.0) for c, s in zip(self.chunks, scores)]
        ranked = sorted(zip(self.chunks, scores), key=lambda x: x[1], reverse=True)
        if source_id:
            ranked = [r for r in ranked if r[0].source_id.lower() == source_id.lower()]
        return [(c, s) for c, s in ranked[:k] if s >= min_score]
