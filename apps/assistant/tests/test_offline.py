"""Test không cần API key: dùng LLM giả để kiểm tra luồng tool-calling và guardrail.
Chạy: python -m pytest tests -q   (hoặc python tests/test_offline.py)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant import config  # noqa: E402

# Test cố định trên dữ liệu MOCK, không phụ thuộc dữ liệu thật đã tải về
config.CHUNKS_FILE = Path("/nonexistent/chunks.jsonl")
config.INVESTIGATIONS_FILE = Path("/nonexistent/investigations.csv")
# Trace của test ghi vào file tạm, không lẫn với log thật
import tempfile  # noqa: E402
config.TRACE_FILE = Path(tempfile.mkdtemp()) / "traces.jsonl"

from assistant.agent import Assistant  # noqa: E402
from assistant.retriever import DocumentRetriever, tokenize  # noqa: E402


def _tool_call(name: str, args: dict, id_: str = "call_1"):
    return NS(id=id_, function=NS(name=name, arguments=json.dumps(args)))


class FakeLLM:
    """Trả lần lượt các message đã soạn sẵn; ghi lại messages nhận được."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.seen = []

    def chat(self, messages, tools=None):
        self.seen.append(list(messages))
        return self.replies.pop(0), 0.0


def test_tokenize_normalizes_o2():
    assert "o2" in tokenize("O₂ concentration")


def test_retriever_finds_mock_passage():
    hits = DocumentRetriever().search("flame spread solid fuel oxygen")
    assert hits and hits[0][0].source_id == "MOCK-DOC-2"


def test_retriever_returns_nothing_for_offtopic():
    assert DocumentRetriever().search("banana bread recipe") == []


def test_tool_loop_and_valid_citation():
    llm = FakeLLM([
        NS(content="", tool_calls=[_tool_call("search_documents", {"query": "ventilation airflow flame"})]),
        NS(content="Tắt thông gió giúp giảm cấp oxy cho ngọn lửa [S1].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Có nên tắt quạt thông gió khi cháy không?")
    assert not a.refused
    assert [c.ref for c in a.citations] == ["S1"]
    assert a.uses_mock_data
    tool_msgs = [m for m in llm.seen[1] if m["role"] == "tool"]
    assert tool_msgs and "[S1]" in tool_msgs[0]["content"]


def test_invented_citation_is_removed_and_refused():
    llm = FakeLLM([NS(content="Ngọn lửa cháy mạnh hơn [S99].", tool_calls=None)])
    a = Assistant(llm=llm).ask("xin chào")
    assert a.refused and not a.citations
    assert any("invalid" in w for w in a.warnings)


def test_refusal_marker():
    llm = FakeLLM([NS(content="[NO_EVIDENCE] Không có dữ liệu về Sao Hỏa.", tool_calls=None)])
    a = Assistant(llm=llm).ask("Cháy trên Sao Hỏa thế nào?")
    assert a.refused and a.answer.startswith("Không có dữ liệu")


def test_grouped_tags_and_investigation_tool():
    llm = FakeLLM([
        NS(content="", tool_calls=[_tool_call("search_investigations", {"fuel_type": "solid", "min_o2": 30})]),
        NS(content="Có nghiên cứu vật liệu rắn ở O₂ ≥ 30% [I1, I2].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Nghiên cứu vật liệu rắn với oxy trên 30%?")
    assert [c.ref for c in a.citations] == ["I1", "I2"]
    assert "[I1][I2]" in a.answer


def test_predict_tool_mock():
    llm = FakeLLM([
        NS(content="", tool_calls=[_tool_call("predict_flammability", {"material": "cotton", "o2_percent": 30})]),
        NS(content="Mô hình hiện là mock, chưa có dự đoán [P1].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Cotton ở 30% O2 có cháy không?")
    assert a.citations[0].kind == "prediction" and a.citations[0].is_mock


def test_tool_error_does_not_crash():
    llm = FakeLLM([
        NS(content="", tool_calls=[_tool_call("predict_flammability", {"o2_percent": 30})]),  # thiếu material
        NS(content="[NO_EVIDENCE] Thiếu thông tin vật liệu.", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Dự đoán giúp tôi")
    assert a.refused and a.tool_calls[-1]["error"]


def test_offline_mode_vietnamese_question():
    a = Assistant(offline=True).ask("Có nên tắt quạt thông gió khi cháy trên tàu vũ trụ?")
    assert not a.refused and a.citations
    assert any(c.source_id == "MOCK-DOC-1" for c in a.citations)
    assert "offline" in a.warnings[0].lower()


def test_offline_mode_lists_investigations():
    a = Assistant(offline=True).ask("Các nghiên cứu về vật liệu rắn và nồng độ oxy")
    assert any(c.kind == "investigation" for c in a.citations)


def test_offline_mode_refuses_offtopic():
    a = Assistant(offline=True).ask("Công thức nấu phở bò")
    assert a.refused and not a.citations


class BrokenLLM:
    def chat(self, messages, tools=None):
        raise ConnectionError("network down")


def test_fallback_to_offline_when_llm_fails():
    a = Assistant(llm=BrokenLLM()).ask("Why are flames spherical in microgravity?")
    assert not a.refused and a.citations
    assert "ConnectionError" in a.warnings[0]


# ---------------- trace ----------------
from assistant.context import prepare_history  # noqa: E402
from assistant.trace import get_trace  # noqa: E402


class UsageLLM(FakeLLM):
    """FakeLLM có last_usage như DeepSeekClient."""

    def chat(self, messages, tools=None):
        self.last_usage = {"prompt_tokens": 100, "completion_tokens": 20, "cache_hit_tokens": 0}
        return super().chat(messages, tools)


def test_trace_records_pipeline():
    llm = UsageLLM([
        NS(content="", tool_calls=[_tool_call("search_documents", {"query": "ventilation airflow flame"})]),
        NS(content="Tắt thông gió giúp giảm cấp oxy [S1].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Có nên tắt quạt thông gió khi cháy không?")
    t = get_trace(a.trace_id)
    kinds = [e["kind"] for e in t["events"]]
    for k in ("compression", "retrieval", "llm_call", "tool_call", "evidence_budget", "guardrail"):
        assert k in kinds, k
    assert t["totals"]["llm_calls"] == 2 and t["totals"]["prompt_tokens"] == 200
    assert a.prompt_tokens == 200 and a.completion_tokens == 40
    assert t["answer"]["citations"][0]["ref"] == "S1"


def test_trace_offline_and_error():
    a = Assistant(offline=True).ask("flame spread solid fuel oxygen")
    assert get_trace(a.trace_id)["mode"] == "offline"


# ---------------- nén context ----------------
def _history(n_turns: int) -> list[dict]:
    h = []
    for i in range(n_turns):
        h += [{"role": "user", "content": f"question {i} about FLEX"},
              {"role": "assistant", "content": f"answer {i} cites [S1][I2] here"}]
    return h


def test_history_compression_with_llm_summary():
    llm = UsageLLM([
        NS(content="User asked about FLEX droplet tests.", tool_calls=None),  # lượt tóm tắt
        NS(content="FLEX dùng giọt nhiên liệu [S1].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Why are flames spherical in microgravity?", history=_history(6))
    final_msgs = llm.seen[-1]
    hist = [m for m in final_msgs if m["role"] in ("user", "assistant")][:-1]  # bỏ câu hỏi hiện tại
    assert len(hist) == 8                                   # giữ 4 lượt gần nhất
    assert any("User asked about FLEX" in m["content"] for m in final_msgs if m["role"] == "system")
    assert all("[S1]" not in m["content"] for m in hist)    # nhãn cũ đã bị xóa
    assert a.conversation_summary.startswith("User asked")
    comp = [e for e in get_trace(a.trace_id)["events"] if e["kind"] == "compression"][0]
    assert comp["summarized"] == 4 and comp["method"] == "llm"


def test_history_compression_extractive_and_cache():
    recent, summary, stats = prepare_history(_history(7), summarize_fn=None)
    assert len(recent) == 8 and stats["method"] == "extractive" and "question 0" in summary
    _, _, stats2 = prepare_history(_history(7), summarize_fn=None)
    assert stats2["method"] == "cache"


def test_short_history_not_summarized():
    recent, summary, stats = prepare_history(_history(2))
    assert len(recent) == 4 and summary == "" and stats["method"] == "none"


def test_evidence_dedup_across_tool_calls():
    q = {"query": "flame spread solid fuel oxygen"}
    llm = UsageLLM([
        NS(content="", tool_calls=[_tool_call("search_documents", q, "c1")]),
        NS(content="", tool_calls=[_tool_call("search_documents", q, "c2")]),
        NS(content="Tốc độ lan lửa tăng theo O2 [S1].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("flame spread solid fuel oxygen")  # prefetch cũng trả các đoạn này
    tool_msgs = [json.loads(m["content"]) for m in llm.seen[-1] if m["role"] == "tool"]
    assert all("text" not in r for r in tool_msgs[-1]["results"])          # lần 2 chỉ gửi nhãn
    budget = [e for e in get_trace(a.trace_id)["events"] if e["kind"] == "evidence_budget"][0]
    assert budget["deduped"] > 0


def test_evidence_budget_truncates():
    old = config.EVIDENCE_CHAR_BUDGET
    config.EVIDENCE_CHAR_BUDGET = 200
    try:
        llm = UsageLLM([NS(content="Tốc độ lan lửa [S1].", tool_calls=None)])
        a = Assistant(llm=llm).ask("flame spread solid fuel oxygen")
        budget = [e for e in get_trace(a.trace_id)["events"] if e["kind"] == "evidence_budget"][0]
        assert budget["truncated"] > 0
    finally:
        config.EVIDENCE_CHAR_BUDGET = old


# ---------------- preview context / ước lượng chi phí ----------------
from assistant import cost  # noqa: E402


def test_preview_matches_real_first_call():
    q = "Có nên tắt quạt thông gió khi cháy không?"
    hist = _history(2)
    p = Assistant(llm=BrokenLLM()).preview_context(q, hist)       # preview không gọi LLM
    llm = UsageLLM([NS(content="Tắt thông gió [S1].", tool_calls=None)])
    Assistant(llm=llm).ask(q, hist)
    assert p["messages"] == llm.seen[0]                            # context giống hệt request thật


def test_preview_parts_and_scenarios():
    p = Assistant(llm=BrokenLLM()).preview_context("flame spread solid fuel oxygen")
    names = [x["part"] for x in p["parts"]]
    assert names[0] == "system_prompt" and names[1] == "tool_schema"
    assert p["first_call_input_tokens"] > 0 and p["prefetch_hits"]
    costs = {s["scenario"]: s for s in p["scenarios"]}
    assert costs["direct"]["cost_usd"] < costs["typical"]["cost_usd"] < costs["worst"]["cost_usd"]
    assert costs["worst"]["llm_calls"] == config.MAX_TOOL_ROUNDS + 1


def test_preview_long_history_does_not_touch_summary_cache():
    hist = _history(9)
    p = Assistant(llm=BrokenLLM()).preview_context("next question", hist)
    assert p["history"]["needs_llm_summary"] is True
    typical_with = next(s for s in p["scenarios"] if s["scenario"] == "typical")
    assert typical_with["llm_calls"] == 3                          # + 1 lượt tóm tắt
    _, _, stats = prepare_history(hist, summarize_fn=lambda older: "real summary")
    assert stats["method"] == "llm"                                # preview không ghi cache


def test_estimate_tokens_vietnamese_costs_more():
    en, vi = "flame spread over solid fuel", "ngọn lửa lan trên nhiên liệu rắn"
    assert cost.estimate_tokens(vi) / len(vi) > cost.estimate_tokens(en) / len(en)
    assert cost.estimate_tokens("abcd" * 10, chars_per_token=4) == 10


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
