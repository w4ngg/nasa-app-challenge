"""Cấu hình chung. Đọc từ biến môi trường hoặc file .env ở thư mục module."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def _load_dotenv(path: Path) -> None:
    """Đọc .env đơn giản (KEY=VALUE), không ghi đè biến đã có."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")

# --- DeepSeek (API tương thích OpenAI) ---
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.1"))
# auto = tự chạy offline khi không có key | 1 = luôn offline | 0 = bắt buộc dùng LLM
OFFLINE_MODE = os.getenv("OFFLINE_MODE", "auto").lower()
# Khi gọi DeepSeek lỗi (mất mạng, hết ngân sách...) thì tự chuyển sang trả lời offline
FALLBACK_OFFLINE = os.getenv("FALLBACK_OFFLINE", "1") == "1"

# Giá USD / 1 triệu token — KIỂM TRA LẠI trên trang giá DeepSeek rồi sửa trong .env
PRICE_INPUT_PER_M = float(os.getenv("DEEPSEEK_PRICE_INPUT_PER_M", "0.27"))
PRICE_OUTPUT_PER_M = float(os.getenv("DEEPSEEK_PRICE_OUTPUT_PER_M", "1.10"))
BUDGET_USD = float(os.getenv("LLM_BUDGET_USD", "9.0"))  # chặn trước mốc $10
USAGE_FILE = Path(os.getenv("LLM_USAGE_FILE", str(ROOT / ".usage.json")))

# --- Retrieval ---
TOP_K = int(os.getenv("RETRIEVAL_TOP_K", "5"))
MIN_SCORE = float(os.getenv("RETRIEVAL_MIN_SCORE", "0.5"))  # dưới ngưỡng coi như không tìm thấy
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "4"))
# Trần số lần search_documents mỗi câu hỏi (không tính prefetch) – tránh câu so sánh search 7 lần tốn tiền
MAX_SEARCHES = int(os.getenv("MAX_SEARCHES", "3"))
# Bộ truy xuất: hybrid (mặc định; BM25 + embedding, thiếu sentence-transformers thì tự về bm25) | bm25 | dense
RETRIEVER = os.getenv("RETRIEVER", "hybrid").lower()
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-base-en-v1.5")
EMBED_DEVICE = os.getenv("EMBED_DEVICE", "")  # trống = tự chọn (mps / cuda / cpu)
EMBED_FILE = Path(os.getenv("EMBED_FILE", str(DATA_DIR / "processed" / "embeddings.npz")))
DENSE_MIN_SIM = float(os.getenv("DENSE_MIN_SIM", "0.6"))  # cosine >= ngưỡng -> embedding tự đề cử chunk
# Hybrid loại cả chunk BM25 khớp chữ nhưng lạc nghĩa ("train a dog" -> "training" trong tài liệu Apollo).
# 0.45: mọi chunk gold của eval đều >= 0.452, mọi câu lạc đề đã thử đều <= 0.42.
DENSE_FLOOR = float(os.getenv("DENSE_FLOOR", "0.45"))
# Cách gộp: weighted = α·BM25/max + (1-α)·(cos - DENSE_FLOOR)/(max - DENSE_FLOOR) (tốt nhất trên eval/retrieval_eval.py)
#           rrf      = Σ 1/(RRF_K + hạng)
HYBRID_FUSION = os.getenv("HYBRID_FUSION", "weighted").lower()
HYBRID_ALPHA = float(os.getenv("HYBRID_ALPHA", "0.6"))  # trọng số BM25 trong weighted fusion
RRF_K = int(os.getenv("RRF_K", "60"))
HYBRID_CANDIDATES = int(os.getenv("HYBRID_CANDIDATES", "30"))  # số ứng viên lấy từ mỗi bên trước khi gộp

# --- Trace (log từng request để gỡ lỗi) ---
TRACE_ENABLED = os.getenv("TRACE_ENABLED", "1") == "1"
TRACE_FILE = Path(os.getenv("TRACE_FILE", str(ROOT / "logs" / "traces.jsonl")))

# --- Nén context ---
HISTORY_KEEP_TURNS = int(os.getenv("HISTORY_KEEP_TURNS", "4"))        # số lượt (user+assistant) giữ nguyên văn
HISTORY_SUMMARY = os.getenv("HISTORY_SUMMARY", "1") == "1"            # tóm tắt lượt cũ bằng LLM
HISTORY_MSG_MAX_CHARS = int(os.getenv("HISTORY_MSG_MAX_CHARS", "2000"))
EVIDENCE_CHAR_BUDGET = int(os.getenv("EVIDENCE_CHAR_BUDGET", "24000"))  # ~6k token cho bằng chứng / request
OVER_BUDGET_SNIPPET_CHARS = int(os.getenv("OVER_BUDGET_SNIPPET_CHARS", "300"))

# Dữ liệu thật (do ingest.py / Module 1 / Module 5 tạo ra). Nếu chưa có -> dùng dữ liệu MOCK.
CHUNKS_FILE = DATA_DIR / "processed" / "chunks.jsonl"
MOCK_CHUNKS_FILE = DATA_DIR / "mock" / "chunks.jsonl"
INVESTIGATIONS_FILE = Path(os.getenv("INVESTIGATIONS_CSV", str(DATA_DIR / "investigations.csv")))
MOCK_INVESTIGATIONS_FILE = DATA_DIR / "mock" / "investigations.json"
# Metadata PSI đầy đủ (scripts/fetch_sources.py) – dùng cho bảng so sánh; thiếu thì dùng bảng investigations
PSI_METADATA_FILE = Path(os.getenv("PSI_METADATA_FILE", str(DATA_DIR / "raw" / "psi_combustion.json")))
# Catalog của web (fuel, vật liệu, khoảng O₂ trích từ bảng thí nghiệm PSI) – bổ sung các cột còn trống.
CATALOG_JSON = Path(os.getenv("CATALOG_JSON", str(ROOT.parent / "web" / "public" / "data" / "index.json")))
# Hàm predict() của Module 5, dạng "package.module:function". Để trống -> dùng mock.
PREDICT_IMPORT = os.getenv("PREDICT_IMPORT", "")
# Hàm rank() của Module 4 (Hân), dạng "package.module:function". Để trống -> công thức minh bạch tạm thời.
RANK_IMPORT = os.getenv("RANK_IMPORT", "")
