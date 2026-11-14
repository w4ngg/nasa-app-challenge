"""Dense retrieval (embedding) cho chế độ hybrid. Tùy chọn: cần `pip install sentence-transformers`.

- Model mặc định BAAI/bge-base-en-v1.5 (chạy local, miễn phí, không gọi API trả tiền).
- Vector của các chunk được lưu ở data/processed/embeddings.npz, gắn với tên model và hash nội dung chunk;
  chunk đổi -> tự encode lại.
- Thiếu thư viện / model -> DenseIndex.load() trả None, retriever tự quay về BM25 (ghi cảnh báo).
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from . import config
from .schema import Chunk

# bge-*-en-v1.5 khuyên thêm tiền tố này cho câu truy vấn (không thêm cho đoạn văn)
_QUERY_PREFIX = {"bge": "Represent this sentence for searching relevant passages: ", "e5": "query: "}
_PASSAGE_PREFIX = {"e5": "passage: "}
_MODELS: dict = {}  # cache model theo tên, dùng chung giữa các retriever


def chunk_text(c: Chunk) -> str:
    return f"{c.title}\n{c.section}\n{c.text}"


def _family(model_name: str) -> str:
    n = model_name.lower()
    return "bge" if "bge" in n else "e5" if "e5" in n else ""


def corpus_hash(chunks: list[Chunk], model_name: str) -> str:
    h = hashlib.sha256(model_name.encode())
    for c in chunks:
        h.update(c.id.encode())
        h.update(chunk_text(c).encode())
    return h.hexdigest()[:16]


def _get_model(name: str):
    if name not in _MODELS:
        from sentence_transformers import SentenceTransformer  # import chậm -> chỉ khi cần
        _MODELS[name] = SentenceTransformer(name, device=config.EMBED_DEVICE or None)
    return _MODELS[name]


class DenseIndex:
    def __init__(self, model_name: str, vectors, model):
        self.model_name, self.vectors, self.model = model_name, vectors, model

    @classmethod
    def load(cls, chunks: list[Chunk], model_name: str | None = None, cache: Path | None = None,
             verbose: bool = True) -> "DenseIndex | None":
        model_name = model_name or config.EMBED_MODEL
        cache = cache or config.EMBED_FILE
        try:
            import numpy as np
            model = _get_model(model_name)
        except Exception as e:  # thiếu thư viện / không tải được model
            if verbose:
                print(f"[retriever] dense retrieval unavailable ({type(e).__name__}: {e}); using BM25 only",
                      file=sys.stderr)
            return None
        key = corpus_hash(chunks, model_name)
        if cache.exists():
            try:
                z = np.load(cache, allow_pickle=False)
                if str(z["key"]) == key and len(z["vectors"]) == len(chunks):
                    return cls(model_name, z["vectors"].astype("float32"), model)
            except Exception:
                pass
        if verbose:
            print(f"[retriever] encoding {len(chunks)} chunks with {model_name} (one-time, cached to {cache.name})…",
                  file=sys.stderr)
        pre = _PASSAGE_PREFIX.get(_family(model_name), "")
        vecs = model.encode([pre + chunk_text(c) for c in chunks], batch_size=32, normalize_embeddings=True,
                            show_progress_bar=verbose, convert_to_numpy=True).astype("float32")
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(cache, key=np.array(key), model=np.array(model_name), vectors=vecs.astype("float16"))
        except OSError:
            pass
        return cls(model_name, vecs, model)

    def scores(self, query: str) -> list[float]:
        """Cosine similarity giữa câu truy vấn và từng chunk (vector đã chuẩn hóa)."""
        q = self.model.encode([_QUERY_PREFIX.get(_family(self.model_name), "") + query],
                              normalize_embeddings=True, convert_to_numpy=True)[0].astype("float32")
        return (self.vectors @ q).tolist()
