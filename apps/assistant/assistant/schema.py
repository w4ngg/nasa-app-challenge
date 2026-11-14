"""Kiểu dữ liệu dùng chung giữa các thành phần."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Chunk:
    """Một đoạn văn bản đã cắt từ tài liệu nguồn (PSI page, NTRS paper, Researcher's Guide...)."""
    id: str                 # vd "PSI-69#3"
    source_id: str          # vd "PSI-69", "NTRS-20150012345"
    title: str
    text: str
    url: str = ""
    section: str = ""
    is_mock: bool = False
    page: int | None = None  # trang PDF (1-based) nếu đoạn lấy từ PDF
    pdf_url: str = ""        # link PDF gốc; kết hợp với page -> page_url

    @classmethod
    def from_dict(cls, d: dict) -> "Chunk":
        kw = {k: d[k] for k in cls.__dataclass_fields__ if k in d and d[k] is not None}
        kw["is_mock"] = bool(kw.get("is_mock", False))
        return cls(**kw)

    @property
    def page_url(self) -> str:
        """Link mở đúng trang: <pdf>#page=N (trình duyệt hỗ trợ). Không có PDF/trang thì trả url thường."""
        if self.pdf_url and self.page:
            return f"{self.pdf_url}#page={self.page}"
        return self.url


@dataclass
class Citation:
    """Trích dẫn trả về cho UI. `ref` khớp với nhãn [S1], [I1], [P1] trong câu trả lời."""
    ref: str
    kind: str               # "document" | "investigation" | "prediction"
    source_id: str
    title: str
    url: str = ""
    snippet: str = ""
    is_mock: bool = False
    page: int | None = None   # trang PDF của đoạn được trích
    page_url: str = ""        # link mở đúng trang (PDF#page=N) hoặc url thường
    evidence: str = ""        # TOÀN VĂN đoạn nguồn (snippet chỉ 300 ký tự) -> để người kiểm định đối chiếu


@dataclass
class Answer:
    question: str
    answer: str
    citations: list[Citation] = field(default_factory=list)
    refused: bool = False               # True khi không đủ bằng chứng để trả lời
    tool_calls: list[dict] = field(default_factory=list)
    uses_mock_data: bool = False
    cost_usd: float = 0.0
    warnings: list[str] = field(default_factory=list)
    trace_id: str = ""                  # tra lại bằng: python -m assistant.trace_view <trace_id>
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    conversation_summary: str = ""      # tóm tắt các lượt cũ đã dùng (nếu có)
    verification: dict = field(default_factory=dict)  # kiểm tra trích dẫn từng câu (assistant/verify.py)
    suggested_sources: list[Citation] = field(default_factory=list)  # nguồn đã truy xuất nhưng chưa trích,
                                                                      # được gợi ý cho câu gắn nhầm tag

    def to_dict(self) -> dict:
        return asdict(self)
