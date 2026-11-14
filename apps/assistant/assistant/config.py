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
# Hàm predict() của Module 5, dạng "package.module:function". Để trống -> dùng mock.
PREDICT_IMPORT = os.getenv("PREDICT_IMPORT", "")
