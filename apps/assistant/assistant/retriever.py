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


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("o₂", "o2").replace("co₂", "co2")
    # [^\W_] giữ nguyên từ có dấu (vd "phở") thay vì cắt thành mảnh "ph" khớp nhầm tài liệu tiếng Anh
    return [t for t in re.findall(r"[^\W_]+(?:[.\-][^\W_]+)*", text)
            if len(t) > 1 and t not in _STOPWORDS]


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

    def scores(self, query: list[str]) -> list[float]:
        out = []
        for tf, dl in zip(self.docs, self.lens):
            s = 0.0
            for t in query:
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
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

    def search(self, query: str, k: int = config.TOP_K, min_score: float = config.MIN_SCORE,
               source_id: str | None = None) -> list[tuple[Chunk, float]]:
        scores = self.bm25.scores(tokenize(query))
        # Danh sách tên bài báo dày từ khóa nhưng ít nội dung giải thích -> giảm trọng số
        scores = [s * SECTION_WEIGHTS.get(c.section, 1.0) for c, s in zip(self.chunks, scores)]
        ranked = sorted(zip(self.chunks, scores), key=lambda x: x[1], reverse=True)
        if source_id:
            ranked = [r for r in ranked if r[0].source_id.lower() == source_id.lower()]
        return [(c, s) for c, s in ranked[:k] if s >= min_score]
