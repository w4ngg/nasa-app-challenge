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


_VI_CHARS = re.compile(r"[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]", re.I)


def dense_query(text: str) -> str:
    """Câu truy vấn cho embedding (model tiếng Anh): câu tiếng Việt -> chỉ dùng từ khóa tiếng Anh đã dịch,
    vì trộn hai thứ tiếng làm cosine thấp (v03: 0.66 -> 0.80). Câu tiếng Anh giữ nguyên."""
    if _VI_CHARS.search(text):
        extra = expand_query(text)[len(text):].strip()
        if extra:
            return extra
    return text


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
    """BM25 (mặc định), hoặc hybrid = BM25 + embedding (config.RETRIEVER).

    Hybrid: mỗi bên lấy HYBRID_CANDIDATES ứng viên vượt ngưỡng riêng (BM25 >= min_score, cosine >= DENSE_MIN_SIM),
    rồi gộp: weighted (mặc định) = α·BM25/max + (1-α)·(cos - DENSE_FLOOR)/(max - DENSE_FLOOR), hoặc rrf = Σ 1/(RRF_K + hạng).
    Một chunk chỉ cần một bên khớp là được giữ, nên câu hỏi diễn đạt khác tài liệu vẫn tìm được, còn câu lạc đề
    (không bên nào vượt ngưỡng) trả về rỗng -> bot từ chối. Chunk BM25 có cosine < DENSE_FLOOR bị loại
    (khớp chữ nhưng lạc nghĩa). Thiếu sentence-transformers -> BM25."""

    def __init__(self, chunks: list[Chunk] | None = None, mode: str | None = None):
        self.chunks = chunks if chunks is not None else load_chunks()
        self.bm25 = BM25([tokenize(f"{c.title} {c.section} {c.text}") for c in self.chunks])
        self.requested_mode = (mode or config.RETRIEVER or "bm25").lower()
        self.dense = None
        if self.requested_mode in ("hybrid", "dense"):
            from .embeddings import DenseIndex
            self.dense = DenseIndex.load(self.chunks)
        self.last_details: list[dict] = []  # điểm từng bên của lần search gần nhất (cho trace / demo)

    def ensure_dense(self) -> bool:
        """Nạp embedding khi cần (vd demo UI chuyển sang hybrid lúc đang chạy). True nếu dùng được."""
        if self.dense is None and not getattr(self, "_dense_failed", False):
            from .embeddings import DenseIndex
            self.dense = DenseIndex.load(self.chunks)
            self._dense_failed = self.dense is None
        return self.dense is not None

    @property
    def mode(self) -> str:
        return self.requested_mode if self.dense is not None else "bm25"

    @property
    def uses_mock(self) -> bool:
        return any(c.is_mock for c in self.chunks)

    def _bm25_scores(self, query: str) -> list[float]:
        scores = self.bm25.scores(query_terms(query))
        # Danh sách tên bài báo dày từ khóa nhưng ít nội dung giải thích -> giảm trọng số
        return [s * SECTION_WEIGHTS.get(c.section, 1.0) for c, s in zip(self.chunks, scores)]

    def search(self, query: str, k: int | None = None, min_score: float | None = None,
               source_id: str | None = None, mode: str | None = None) -> list[tuple[Chunk, float]]:
        """Trả về [(chunk, score)]. bm25: score = điểm BM25. hybrid: score = điểm gộp (weighted: 0-1; rrf: ~0.01-0.03);
        dense: cosine. Ngưỡng lọc áp lên điểm từng bên trước khi gộp; điểm gộp chỉ để xếp hạng."""
        # đọc config lúc gọi (không phải lúc import) để chỉnh được khi đang chạy (demo UI)
        k = config.TOP_K if k is None else k
        min_score = config.MIN_SCORE if min_score is None else min_score
        mode = (mode or self.mode).lower()
        if mode != "bm25" and self.dense is None:
            mode = "bm25"
        idx = range(len(self.chunks))
        if source_id:
            idx = [i for i in idx if self.chunks[i].source_id.lower() == source_id.lower()]
        bm = self._bm25_scores(query)
        if mode == "bm25":
            ranked = sorted(idx, key=lambda i: bm[i], reverse=True)
            out = [i for i in ranked[:k] if bm[i] >= min_score]
            self.last_details = [{"chunk": self.chunks[i].id, "bm25": round(bm[i], 3)} for i in out]
            return [(self.chunks[i], bm[i]) for i in out]

        dn = self.dense.scores(dense_query(query))
        n = config.HYBRID_CANDIDATES
        bm_rank = [i for i in sorted(idx, key=lambda i: bm[i], reverse=True)
                   if bm[i] >= min_score and dn[i] >= config.DENSE_FLOOR][:n]
        dn_rank = [i for i in sorted(idx, key=lambda i: dn[i], reverse=True) if dn[i] >= config.DENSE_MIN_SIM][:n]
        fused: dict[int, float] = {}
        if mode == "dense":
            fused = {i: dn[i] for i in dn_rank}
        elif config.HYBRID_FUSION == "rrf":
            for lst in (bm_rank, dn_rank):
                for r, i in enumerate(lst, 1):
                    fused[i] = fused.get(i, 0.0) + 1.0 / (config.RRF_K + r)
        else:
            cand = set(bm_rank) | set(dn_rank)
            if cand:
                # cosine chuẩn hóa từ mốc DENSE_FLOOR (không dùng min-max: min-max phóng đại chênh lệch rất nhỏ)
                bmax = max(bm[i] for i in cand) or 1.0
                lo, dmax = config.DENSE_FLOOR, max(dn[i] for i in cand)
                a = config.HYBRID_ALPHA
                fused = {i: a * bm[i] / bmax + (1 - a) * max(0.0, dn[i] - lo) / ((dmax - lo) or 1.0) for i in cand}
        top = sorted(fused, key=lambda i: (-fused[i], -bm[i]))[:k]
        bpos = {i: r for r, i in enumerate(bm_rank, 1)}
        dpos = {i: r for r, i in enumerate(dn_rank, 1)}
        self.last_details = [{"chunk": self.chunks[i].id, "bm25": round(bm[i], 3), "dense": round(dn[i], 3),
                              "bm25_rank": bpos.get(i), "dense_rank": dpos.get(i), "fused": round(fused[i], 4)}
                             for i in top]
        return [(self.chunks[i], round(fused[i], 4)) for i in top]
