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

    @classmethod
    def from_dict(cls, d: dict) -> "Chunk":
        return cls(**{k: d.get(k, "") if k != "is_mock" else bool(d.get(k, False))
                      for k in cls.__dataclass_fields__})


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

    def to_dict(self) -> dict:
        return asdict(self)
