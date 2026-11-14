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
config.PSI_METADATA_FILE = Path("/nonexistent/psi_combustion.json")
config.RETRIEVER = "bm25"  # test nhanh, không tải model embedding; hybrid được test bằng dense giả bên dưới
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


# ---------------- (3) stemming + từ đồng nghĩa ----------------
from assistant import integrations  # noqa: E402
from assistant.retriever import query_terms, stem  # noqa: E402
from assistant.schema import Chunk  # noqa: E402
from assistant.verify import check_sentence, verify_answer  # noqa: E402


def test_stemmer_conservative():
    assert stem("firefighters") == stem("firefighter")
    assert stem("investigators") == stem("investigator")
    assert stem("studies") == "study" and stem("burning") == "burn"
    assert stem("flames") == stem("flame") and stem("measured") == stem("measure")
    for keep in ("speed", "string", "gas", "co2", "bass-ii", "analysis", "status"):
        assert stem(keep) == keep


def test_synonym_expansion_weighted():
    t = query_terms("firefighter equipment")
    assert t[stem("firefighter")] == 1.0 and t[stem("fireman")] == 0.5


def _mini(chunks):
    return DocumentRetriever([Chunk(id=f"D{i}#1", source_id=f"D{i}", title=f"Doc {i}", text=x)
                              for i, x in enumerate(chunks)])


def test_synonym_retrieval_finds_fireman_doc():
    r = _mini(["Lightweight air tanks for firemen developed from spacesuit technology.",
               "Smoke particle sizes measured in microgravity.", "Droplet combustion of heptane."])
    hits = r.search("improved firefighter breathing equipment", k=3, min_score=0)
    assert hits and hits[0][0].source_id == "D0"


# ---------------- (2) link mở đúng trang PDF ----------------
def test_page_url_on_chunk_and_citation():
    c = Chunk(id="R#1", source_id="R", title="Guide", text="flame spread over solid fuel in oxygen",
              url="https://x.gov/guide.pdf", section="p. 12", page=12, pdf_url="https://x.gov/guide.pdf")
    assert c.page_url == "https://x.gov/guide.pdf#page=12"
    assert Chunk(id="P#1", source_id="P", title="t", text="x", url="https://psi").page_url == "https://psi"
    llm = UsageLLM([NS(content="Flame spread over solid fuel depends on oxygen [S1].", tool_calls=None)])
    a = Assistant(llm=llm, retriever=DocumentRetriever([c])).ask("flame spread solid fuel oxygen")
    assert a.citations[0].page == 12 and a.citations[0].page_url.endswith("#page=12")


# ---------------- (4) so sánh dạng bảng ----------------
_FAKE_RECS = [
    {"psi_id": "PSI-26", "acronym": "BASS", "title": "Burning and Suppression of Solids", "hardware": "MSG", "link": ""},
    {"psi_id": "PSI-25", "acronym": "BASS-II", "title": "Burning and Suppression of Solids - II", "hardware": "MSG", "link": ""},
    {"psi_id": "PSI-98", "acronym": "SAFFIRE-I", "title": "Spacecraft Fire Experiment-I", "hardware": "Cygnus", "link": ""},
    {"psi_id": "PSI-99", "acronym": "SAFFIRE-II", "title": "Spacecraft Fire Experiment-II", "hardware": "Cygnus", "link": ""},
    {"psi_id": "PSI-47", "acronym": "DAFT / DAFT-2", "title": "Dust and Aerosol Test", "hardware": "ISS", "link": ""},
    {"psi_id": "PSI-102", "acronym": "SAME", "title": "Smoke and Aerosol Measurement Experiment", "hardware": "MSG", "link": ""},
    {"psi_id": "PSI-10", "acronym": "ACME/Flame Design", "title": "ACME Flame Design", "hardware": "CIR", "link": ""},
    {"psi_id": "PSI-20", "acronym": "ACME BRE", "title": "ACME Burning Rate Emulator", "hardware": "CIR", "link": ""},
]


def test_resolve_and_detect_names(monkeypatch):
    monkeypatch.setattr(integrations, "psi_records", lambda: _FAKE_RECS)
    ids = lambda names: [r["psi_id"] for r in integrations.resolve_investigations(names)[0]]  # noqa: E731
    assert ids(["BASS"]) == ["PSI-26"]                                   # khớp chính xác trước
    assert ids(["Saffire"]) == ["PSI-98", "PSI-99"]                      # family -> I, II
    assert ids(["DAFT-2"]) == ["PSI-47"] and ids(["ACME"]) == ["PSI-10", "PSI-20"]
    assert integrations.resolve_investigations(["nope"])[1] == ["nope"]
    q = "How was the same instrument used differently in SAME and DAFT?"
    assert set(integrations.detect_investigation_names(q)) == {"same", "daft"}
    assert integrations.detect_investigation_names("Is the same thing true?") == []


def test_compare_tool_builds_table(monkeypatch):
    monkeypatch.setattr(integrations, "psi_records", lambda: _FAKE_RECS)
    llm = UsageLLM([
        NS(content="", tool_calls=[_tool_call("compare_investigations", {"investigations": ["BASS", "Saffire"]})]),
        NS(content="Table follows [I1][I2][I3].", tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Compare BASS and Saffire")
    res = json.loads([m for m in llm.seen[-1] if m["role"] == "tool"][0]["content"])
    table = res["table_markdown"]
    assert table.startswith("| Attribute | PSI-26 BASS [I1] | PSI-98 SAFFIRE-I [I2] | PSI-99 SAFFIRE-II [I3] |")
    assert "| Hardware | MSG | Cygnus | Cygnus |" in table
    assert "Hardware" in res["different_attributes"]
    assert [c.kind for c in a.citations] == ["investigation"] * 3


def test_compare_table_edited_by_model_is_restored(monkeypatch):
    monkeypatch.setattr(integrations, "psi_records", lambda: _FAKE_RECS)
    edited = ("| Attribute | PSI-26 BASS [I1] | PSI-98 SAFFIRE-I [I2] |\n|---|---|---|\n"
              "| Title | Burning of Solids | Spacecraft Fire Experiment-I |\n| Hardware | MSG | Cygnus |\n"
              "BASS used the glovebox [I1].")
    llm = UsageLLM([
        NS(content="", tool_calls=[_tool_call("compare_investigations", {"investigations": ["BASS", "SAFFIRE-I"]})]),
        NS(content=edited, tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Compare BASS and SAFFIRE-I")
    assert "| Title | Burning and Suppression of Solids | Spacecraft Fire Experiment-I |" in a.answer
    assert "Burning of Solids |" not in a.answer
    assert any("Restored" in w for w in a.warnings)
    assert any(e["kind"] == "table_restored" for e in get_trace(a.trace_id)["events"])


def test_compare_offline_mode(monkeypatch):
    monkeypatch.setattr(integrations, "psi_records", lambda: _FAKE_RECS)
    a = Assistant(offline=True).ask("Compare BASS and Saffire")
    assert "| Attribute |" in a.answer and any(c.source_id == "PSI-26" for c in a.citations)


# ---------------- (1) kiểm tra trích dẫn ----------------
EV = ("FLEX measured the effectiveness of gaseous suppressants CO2, He and SF6 on burning droplets in "
      "microgravity. Air tanks pressurized at 4,500 psi.")


def test_check_sentence_levels():
    assert check_sentence("FLEX tested gaseous suppressants such as CO2 and SF6 [S1].", EV)["status"] == "supported"
    bad = check_sentence("Saffire burned large cotton fabric samples inside Cygnus [S1].", EV)
    assert bad["status"] == "unsupported"
    num = check_sentence("The air tanks were pressurized at 6,000 psi [S1].", EV)
    assert num["status"] == "weak" and num["missing_numbers"] == ["6,000"]
    assert check_sentence("Air tanks were pressurized at 4500 psi [S1].", EV)["missing_numbers"] == []


def test_verify_answer_skips_tables_and_meta():
    ans = ("| Attribute | A [I1] |\n|---|---|\n| Hardware | MSG |\n"
           "- FLEX tested gaseous suppressants such as CO2 and SF6 [S1].\n"
           "Limitations: the evidence does not report flame temperatures [S1].")
    v = verify_answer(ans, {"S1": EV})
    assert v["checked"] == 1 and v["supported"] == 1


def test_agent_attaches_verification_and_warns():
    llm = UsageLLM([NS(content="Ventilation shutdown is advised [S1]. Rocket propellants explode violently [S1].",
                       tool_calls=None)])
    a = Assistant(llm=llm).ask("Should ventilation be turned off during a cabin fire?")
    assert a.verification["checked"] == 2 and a.verification["unsupported"] >= 1
    assert any("unsupported" in w for w in a.warnings)
    ev = [e for e in get_trace(a.trace_id)["events"] if e["kind"] == "verification"][0]
    assert ev["flagged"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)


# ---------- three RAG criteria: faithfulness / citation correctness / answer correctness ----------
from assistant.evaluate import pin_saved_citations, score_facts  # noqa: E402

EV2 = "Saffire-I burned a Sibal fabric sample, 75% cotton and 25% fiberglass, inside the Cygnus vehicle."


def test_faithful_but_miscited_sentence_gets_suggested_tag():
    ans = "Saffire-I burned Sibal fabric of 75% cotton and 25% fiberglass in Cygnus [S1]."
    v = verify_answer(ans, {"S1": EV, "S2": EV2})
    x = v["sentences"][0]
    assert x["status"] != "supported" and x["context_status"] == "supported"
    assert x["miscited"] and x["suggested_refs"] == ["S2"]
    assert v["miscited"] == 1 and v["faithfulness"]["score"] == 1.0


def test_hallucinated_sentence_is_unfaithful():
    v = verify_answer("Saturn rings contain frozen methane lakes and volcanic glaciers [S1].", {"S1": EV, "S2": EV2})
    assert v["sentences"][0]["context_status"] == "unsupported" and v["faithfulness"]["unsupported"] == 1


def test_inference_words_and_interpretation_lines_are_flagged():
    ans = ("FLEX tested CO2, He and SF6 suppressants on droplets, implying all suppressants fail in space [S1].\n"
           "Interpretation: FLEX suppressant results matter for ISS design [S1].")
    v = verify_answer(ans, {"S1": EV})
    assert v["inference"] == 2
    assert "implying" in v["sentences"][0]["inference"] and "interpretation" in v["sentences"][1]["inference"]


def test_disclaimer_and_term_variants_not_flagged():
    ev = "FLEX burned heptane droplets in oxygen and nitrogen mixtures; O₂ fraction was varied."
    v = verify_answer("FLEX-1 burned heptane droplets while the O2 fraction was varied [S1].\n"
                      "Verify all figures against the original NASA sources before design use.", {"S1": ev})
    assert v["claims"] == 1 and v["supported"] == 1 and v["inference"] == 0


def test_answer_correctness_gold_facts():
    facts = [{"fact": "FLEX suppressants", "keywords": ["co2|carbon dioxide", "helium|\\bhe\\b"], "source": "x"},
             {"fact": "SF6", "keywords": ["sf6"], "source": "x"}]
    r = score_facts("FLEX tested carbon dioxide and helium.", facts)
    assert r["covered"] == 1 and r["score"] == 0.5 and r["facts"][1]["missing"] == ["sf6"]


def test_pin_saved_citations_maps_snippet_to_full_chunk():
    bot = Assistant(offline=True)
    reg = __import__("assistant.agent", fromlist=["EvidenceRegistry"]).EvidenceRegistry()
    ch = bot.retriever.chunks[0]
    reg.texts["S1"] = "something else"
    n = pin_saved_citations(bot, reg, [{"ref": "S1", "kind": "document", "snippet": ch.text[:300]}])
    assert n == 1 and reg.texts["S1"].endswith(ch.text) and reg.texts["_replay_S1"] == "something else"


def test_agent_answer_carries_full_evidence_and_criteria():
    llm = UsageLLM([NS(content="Ventilation shutdown is advised [S1].", tool_calls=None)])
    a = Assistant(llm=llm).ask("Should ventilation be turned off during a cabin fire?")
    assert a.citations and a.citations[0].evidence and len(a.citations[0].evidence) >= len(a.citations[0].snippet)
    assert "faithfulness" in a.verification and "citation_correctness" in a.verification


def test_gold_facts_are_grounded_in_their_source_chunks():
    real = Path(__file__).resolve().parent.parent / "data" / "processed" / "chunks.jsonl"
    if not real.exists():
        return  # gold facts reference the real corpus; skipped when only mock data is present
    import re
    chunks = {json.loads(l)["id"]: json.loads(l) for l in real.read_text(encoding="utf-8").split("\n") if l.strip()}
    qfile = Path(__file__).resolve().parent.parent / "eval" / "questions.jsonl"
    for line in qfile.read_text(encoding="utf-8").splitlines():
        q = json.loads(line)
        for f in q.get("reference_facts", []):
            if f["source"].startswith("SCENARIO:"):  # scenario conditions quoted from the challenge statement
                text = ranking.SCENARIOS[f["source"].split(":", 1)[1]]["conditions"].lower()
            else:
                c = chunks[f["source"]]
                text = (c["title"] + " " + c["text"]).lower()
            assert all(re.search(k, text) for k in f["keywords"]), (q["id"], f["fact"])


# ---------- Catalog conditions from the web app and the hidden mock tool ----------

def test_catalog_conditions_fill_structured_filters(tmp_path, monkeypatch):
    from assistant import integrations
    catalog = {"investigations": [{
        "id": "PSI-25", "platform": "iss",
        "conditions": {"fuels": ["PMMA", "Nomex"], "fuel_categories": ["solid"], "run_count": 129,
                       "o2": [{"basis": "ambient", "min_percent": 13.6, "max_percent": 22.2}]},
    }, {
        "id": "PSI-10", "platform": "iss",
        "conditions": {"fuels": ["Ethylene"], "fuel_categories": ["gas"], "run_count": 327,
                       "o2": [{"basis": "ambient", "min_percent": 19.8, "max_percent": 40},
                              {"basis": "oxidizer_stream", "min_percent": 21.2, "max_percent": 85}]},
    }]}
    path = tmp_path / "index.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    monkeypatch.setattr(config, "CATALOG_JSON", path)
    cond = integrations.catalog_conditions()
    assert cond["PSI-25"]["material"] == "PMMA, Nomex" and cond["PSI-25"]["o2_max"] == 22.2
    assert cond["PSI-10"]["o2_range"] == "19.8–40 (chamber); 21.2–85 (burner-fed)"
    assert cond["PSI-25"]["gravity"] == "microgravity (ISS)"
    row = integrations._fill({"psi_id": "PSI-25", "material": "", "o2_max": ""}, cond["PSI-25"])
    assert row["material"] == "PMMA, Nomex" and row["o2_max"] == 22.2


def test_mock_prediction_tool_is_hidden_without_a_model(monkeypatch):
    from assistant.prompts import active_tools
    monkeypatch.setattr(config, "PREDICT_IMPORT", "")
    assert "predict_flammability" not in [t["function"]["name"] for t in active_tools()]
    monkeypatch.setattr(config, "PREDICT_IMPORT", "module5.model:predict")
    assert "predict_flammability" in [t["function"]["name"] for t in active_tools()]


# ---------- streaming, search cap, scenario ranking ----------
from assistant import ranking  # noqa: E402


class StreamLLM(UsageLLM):
    """Fake LLM with chat_stream: emits the reply content word by word."""

    def chat_stream(self, messages, tools=None, on_text=None):
        msg, cost = self.chat(messages, tools)
        for w in (msg.content or "").split(" "):
            if on_text and w:
                on_text(w + " ")
        return msg, cost


def test_streaming_emits_status_deltas_and_final_answer():
    llm = StreamLLM([
        NS(content="Let me search.", tool_calls=[_tool_call("search_documents", {"query": "ventilation airflow"})]),
        NS(content="Ventilation airflow strongly enhances flames [S1].", tool_calls=None),
    ])
    events = []
    a = Assistant(llm=llm).ask("Should ventilation be turned off?", on_event=events.append)
    kinds = [e["type"] for e in events]
    assert "status" in kinds and "delta" in kinds and "reset" in kinds
    assert kinds.index("reset") < len(kinds) - 1  # pre-tool chatter discarded, final text streamed after it
    streamed = "".join(e["text"] for e in events[kinds.index("reset") + 1:] if e["type"] == "delta")
    assert "enhances flames" in streamed and a.answer.startswith("Ventilation")
    assert any("Searching documents" in e.get("text", "") for e in events)


def test_no_callback_means_no_streaming_call():
    llm = StreamLLM([NS(content="Flames are spherical [S1].", tool_calls=None)])
    llm.chat_stream = None  # would crash if used
    assert Assistant(llm=llm).ask("Why are flames spherical?").answer


def test_search_cap_blocks_extra_searches(monkeypatch):
    monkeypatch.setattr(config, "MAX_SEARCHES", 2)
    calls = [_tool_call("search_documents", {"query": f"flame spread {i}"}, id_=f"c{i}") for i in range(4)]
    llm = UsageLLM([NS(content="", tool_calls=calls), NS(content="Flame spread depends on airflow [S1].", tool_calls=None)])
    a = Assistant(llm=llm).ask("How does airflow affect flame spread?")
    errs = [t for t in a.tool_calls if t["name"] == "search_documents" and t.get("error")]
    assert len(errs) == 2 and "search limit" in errs[0]["error"]


def test_resolve_scenario_aliases():
    assert ranking.resolve_scenario("moon_base") == "moon_base"
    assert ranking.resolve_scenario("Which studies matter for a lunar habitat?") == "moon_base"
    assert ranking.resolve_scenario("căn cứ trên sao Hỏa") == "mars_base"
    assert ranking.resolve_scenario("ISS cabin") == "spacecraft"
    assert ranking.resolve_scenario("pressurized rover") == "rover"


def test_builtin_rank_is_transparent_and_need_aware():
    recs = [
        {"psi_id": "PSI-1", "title": "Smoke detection study", "sub_area": "Spacecraft Fire Safety",
         "keywords": "smoke, aerosol, particulate, detector", "objective": "measure smoke particle size in microgravity on the ISS"},
        {"psi_id": "PSI-2", "title": "Suppression of cotton fabric flames", "sub_area": "Spacecraft Fire Safety",
         "keywords": "extinguish, CO2, inert gas, cotton, fabric", "objective": "extinguishing agent effect on flame spread with forced flow"},
        {"psi_id": "PSI-3", "title": "Soot in gas jets", "sub_area": "Combustion", "keywords": "soot", "objective": "soot"},
    ]
    det = ranking.builtin_rank(recs, {}, "spacecraft", need="detection")
    sup = ranking.builtin_rank(recs, {}, "spacecraft", need="suppression")
    assert det[0]["psi_id"] == "PSI-1" and sup[0]["psi_id"] == "PSI-2" and det[-1]["psi_id"] == "PSI-3"
    assert all(0 <= r["score"] <= 100 and r["reasons"] for r in det)
    assert any("detection" in why for why in det[0]["reasons"])


def test_psi_word_is_not_a_pressure_unit():
    assert not ranking._hits(ranking._PRESSURE, "PSI-25 metadata in the PSI database")
    assert ranking._hits(ranking._PRESSURE, "tests at 0.5-1.5 atm and 10.2 psia")


def test_rank_tool_table_tags_and_restore():
    llm = UsageLLM([
        NS(content="", tool_calls=[_tool_call("rank_investigations", {"scenario": "moon_base", "top_k": 3})]),
        NS(content="Ranking [R1]:\n| Rank | Investigation | Relevance (0-100) | Publications in PSI | Why it ranks here |\n"
                   "|---|---|---|---|---|\n| 1 | edited [I1] | 99 | 1 | x |\nPSI has no partial-gravity data [R1].",
           tool_calls=None),
    ])
    a = Assistant(llm=llm).ask("Which investigations are most relevant for a Moon base?")
    assert any(c.ref == "R1" and c.kind == "scenario" for c in a.citations)
    assert "edited" not in a.answer and any("Restored" in w for w in a.warnings)
    tc = [t for t in a.tool_calls if t["name"] == "rank_investigations"][0]
    assert not tc.get("error")


def test_rank_uses_module4_when_configured(monkeypatch):
    import types
    mod = types.ModuleType("fake_module4")
    mod.rank = lambda scenario, need=None, top_k=5: [{"psi_id": "PSI-69", "score": 88.0, "reasons": ["module 4"]}]
    monkeypatch.setitem(sys.modules, "fake_module4", mod)
    monkeypatch.setattr(config, "RANK_IMPORT", "fake_module4:rank")
    res = ranking.rank([{"psi_id": "PSI-69", "title": "FLEX"}], {}, "spacecraft")
    assert res["is_placeholder"] is False and res["rows"][0]["title"] == "FLEX"


def test_offline_rank_question_builds_table():
    a = Assistant(offline=True).ask("Which investigations are most relevant for a spacecraft cabin?")
    assert "| Rank |" in a.answer and any(c.kind == "scenario" for c in a.citations)


def test_demo_rank_and_eval_endpoints():
    from assistant import demo_server as d
    code, r = d.handle("POST", "/api/rank", {}, {"scenario": "moon base", "need": "prevention", "top_k": 3})
    assert code == 200 and r["scenario_key"] == "moon_base" and len(r["ranked"]) == 3
    assert r["is_placeholder"] and r["scenario_conditions_tag"].startswith("[R")
    assert d.handle("POST", "/api/rank", {}, {"scenario": "jupiter"})[0] == 400
    code, idx = d.handle("GET", "/api/eval", {}, {})
    assert code == 200 and "files" in idx and idx["questions"]
    for bad in ("../.env", "questions.jsonl", "results/../../x.jsonl"):
        assert d.handle("GET", "/api/eval", {"file": [bad]}, {})[0] == 404


class _FakeDense:
    """Dense index giả: cosine định sẵn theo từ khóa, không cần sentence-transformers."""
    def __init__(self, chunks, table):
        self.chunks, self.table = chunks, table

    def scores(self, query):
        return [self.table.get((query.split()[0], c.id), 0.3) for c in self.chunks]


def _hybrid(chunks, table, monkeypatch, **cfg):
    for k, v in {"HYBRID_FUSION": "weighted", "HYBRID_ALPHA": 0.6, "DENSE_MIN_SIM": 0.6, "DENSE_FLOOR": 0.45,
                 "HYBRID_CANDIDATES": 30, "MIN_SCORE": 0.1, **cfg}.items():
        monkeypatch.setattr(config, k, v)
    r = DocumentRetriever(chunks, mode="bm25")
    r.dense, r.requested_mode = _FakeDense(chunks, table), "hybrid"
    return r


def test_hybrid_finds_paraphrase_bm25_misses(monkeypatch):
    from assistant.schema import Chunk
    ch = [Chunk(id="A#1", source_id="A", title="A", text="air circulation slowed the smouldering sheet"),
          Chunk(id="B#1", source_id="B", title="B", text="ventilation ventilation ventilation schedule for the crew")]
    r = _hybrid(ch, {("ventilation", "A#1"): 0.8, ("ventilation", "B#1"): 0.5}, monkeypatch)
    assert [c.id for c, _ in r.search("ventilation effect on flames", k=2, mode="bm25")] == ["B#1"]
    hits = r.search("ventilation effect on flames", k=2)
    assert {c.id for c, _ in hits} == {"A#1", "B#1"} and r.mode == "hybrid"
    assert r.last_details[0]["dense"] is not None


def test_hybrid_drops_lexical_offtopic_match(monkeypatch):
    from assistant.schema import Chunk
    ch = [Chunk(id="APOLLO#1", source_id="APOLLO", title="Apollo", text="crew training for the pad test")]
    r = _hybrid(ch, {("training", "APOLLO#1"): 0.35}, monkeypatch)
    assert r.search("training a dog", mode="bm25")          # BM25 khớp chữ "training"
    assert r.search("training a dog") == []                 # cosine 0.35 < DENSE_FLOOR -> loại


def test_hybrid_falls_back_to_bm25_without_dense(monkeypatch):
    monkeypatch.setattr(config, "RETRIEVER", "hybrid")
    import assistant.embeddings as emb
    monkeypatch.setattr(emb.DenseIndex, "load", classmethod(lambda cls, *a, **k: None))
    r = DocumentRetriever()
    assert r.mode == "bm25" and r.search("flame spread solid fuel oxygen")


def test_dense_query_uses_english_keywords_for_vietnamese():
    from assistant.retriever import dense_query
    assert dense_query("Vì sao ngọn lửa trong vi trọng lực có dạng hình cầu?") == "microgravity flame spherical"
    assert dense_query("How do flames spread in microgravity?") == "How do flames spread in microgravity?"


_TEST_BASE = {"nodes": [{"id": "PSI-1", "type": "investigation", "label": "FLEX"},
                        {"id": "fuel:nomex", "type": "concept", "group": "fuel", "label": "Nomex"},
                        {"id": "concept:smoke", "type": "concept", "group": "phenomenon", "label": "Smoke"}],
              "edges": [{"id": "a", "source": "PSI-1", "target": "fuel:nomex", "type": "uses_fuel",
                         "evidence": "3 experiment-table rows name it", "url": ""}]}
_TEST_EXT = {"nodes": [{"id": "incident:mir-1997", "type": "incident", "label": "Mir oxygen-generator fire (1997)"},
                       {"id": "hardware:cir", "type": "hardware", "label": "Combustion Integrated Rack (CIR)"}],
             "edges": [{"id": "b", "source": "incident:mir-1997", "target": "concept:smoke", "type": "involved",
                        "evidence": "filled the station's modules with smoke", "url": "", "chunk": "MOCK-DOC-1#1"},
                       {"id": "c", "source": "PSI-1", "target": "hardware:cir", "type": "uses_hardware",
                        "evidence": "Hardware: CIR", "url": "", "chunk": None},
                       {"id": "d", "source": "PSI-1", "target": "missing:node", "type": "x", "evidence": "", "url": ""}]}


def test_graph_merges_extension_and_resolves_aliases():
    from assistant.kg import KnowledgeGraph
    g = KnowledgeGraph(_TEST_BASE, _TEST_EXT)
    assert g.resolve("Mir") == ["incident:mir-1997"] and g.resolve("psi 1") == ["PSI-1"]
    assert g.resolve("FLEX") == ["PSI-1"] and g.resolve("CIR") == ["hardware:cir"]
    assert {x["node"] for x in g.neighbors("PSI-1")} == {"fuel:nomex", "hardware:cir"}  # edge to missing node dropped
    assert g.neighbors("concept:smoke")[0]["direction"] == "in"


def test_explore_graph_tool_tags_evidence(monkeypatch):
    from assistant import kg
    from assistant.agent import Assistant, EvidenceRegistry
    monkeypatch.setattr(kg, "_GRAPH", kg.KnowledgeGraph(_TEST_BASE, _TEST_EXT))
    monkeypatch.setattr(integrations, "psi_records", lambda: [{"psi_id": "PSI-1", "title": "FLEX", "link": ""}])
    bot, reg = Assistant(offline=True), EvidenceRegistry()
    r = bot._tool_explore_graph(reg, "Mir 1997")
    assert r["type"] == "incident" and r["links"][0]["tag"] == "[S1]"      # chunk evidence -> [S#]
    r = bot._tool_explore_graph(reg, "FLEX")
    tags = {l["node"]: l["tag"] for l in r["links"]}
    assert tags["Nomex"] == "[I1]" and "3 experiment-table rows" in reg.texts["I1"]  # PSI edge -> [I#]
    assert "error" in bot._tool_explore_graph(reg, "zzzz")


def test_api_paid_mode_needs_key_and_confirmation(monkeypatch):
    import pytest
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from assistant import api
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")
    c = TestClient(api.app)
    h = c.get("/health").json()
    assert h["llm_available"] is False and "spent_usd" in h["budget"]
    assert c.post("/ask", json={"question": "flame spread", "mode": "llm", "confirm_paid": True}).status_code == 503
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "sk-test-not-real")
    assert c.post("/ask", json={"question": "flame spread", "mode": "llm"}).status_code == 400   # no confirm_paid
    assert c.post("/ask/stream", json={"question": "flame spread", "mode": "llm"}).status_code == 400
    r = c.post("/ask", json={"question": "flame spread solid fuel oxygen", "mode": "offline"})
    assert r.status_code == 200 and r.json()["cost_usd"] == 0
