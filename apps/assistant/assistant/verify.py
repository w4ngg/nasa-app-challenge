"""Kiểm định câu trả lời theo 2 tiêu chí độc lập (heuristic, KHÔNG gọi LLM, miễn phí).

  • Citation correctness – câu có được chính các nguồn GẮN TAG ủng hộ không (status).
  • Faithfulness        – câu có suy ra được từ TOÀN BỘ context đã truy xuất không (context_status),
                          bất kể tag. Phân biệt: "bịa" (không có trong context) vs "gắn nhầm tag"
                          (có trong context nhưng ở nguồn khác -> gợi ý tag đúng: suggested_refs).
  • Inference flag      – câu chứa từ suy luận/khái quát hóa (therefore, suggests, always, all...) ->
                          người đọc cần xem lại vì heuristic chỉ kiểm từ vựng, không kiểm logic.
Tiêu chí thứ 3, Answer correctness (đúng với tài liệu NASA gốc), chấm trong eval/run_eval.py bằng
reference_facts viết tay từ nguồn gốc.

Với mỗi câu có nhãn [S#]/[I#]/[P#], so câu đó với nội dung các đoạn được trích:
  1. overlap  – tỉ lệ từ nội dung (đã stem, tính cả từ đồng nghĩa) của câu xuất hiện trong nguồn
  2. numbers  – mọi con số trong câu (4,500 / 70% / 1130 K) phải có trong nguồn
  3. terms    – từ viết tắt / công thức (SF6, CO2, MSG, BASS-II) phải có trong nguồn
Mức:  supported   overlap >= SUPPORTED_MIN, không thiếu số/thuật ngữ
      weak        overlap >= WEAK_MIN nhưng thấp, hoặc thiếu số/thuật ngữ  -> nên đọc lại
      unsupported overlap < WEAK_MIN                                    -> rất có thể trích sai nguồn
Heuristic: diễn đạt lại (paraphrase) mạnh có thể bị đánh "weak" dù đúng. Chỉ cảnh báo, không tự xóa câu.
Ngưỡng được hiệu chỉnh trên 17 câu trả lời DeepSeek thật (xem tests/test_offline.py, README).
"""
from __future__ import annotations

import re

from .retriever import _SYN, tokenize

SUPPORTED_MIN = 0.5
WEAK_MIN = 0.3

_TAG = re.compile(r"\[([SIPR]\d+)\]")
# từ quá chung, không mang thông tin để kiểm chứng
_GENERIC = {tokenize(w)[0] for w in """
nasa evidence source sources data result results study studies investigation investigations experiment
experiments research also however include includes included including used using use based show shows
shown found report reports reported describe described note noted state stated provide provided
retrieved passage passages specific specifically limitation limitations available information
but not only also mention mentions mentioned contain contains contained give gives given list lists listed
among different differ treat treated support supports supported literature context related focus focused
key main overall general generally particular example examples relevant regarding
""".split() if tokenize(w)}
# câu "meta" nói về chính bằng chứng, không phải khẳng định khoa học -> không kiểm tra
_META = re.compile(r"^(\*\*|_)?\s*(limitations?|verify|for design|this is research insight)s?\b", re.I)
_BOLD_LINE = re.compile(r"^\*\*[^*]+\*\*:?$")
_NUM = re.compile(r"(?<![\w.])(?<![A-Za-z]-)\d+(?:[.,]\d+)*")
_TERM = re.compile(r"\b(?=[A-Za-z0-9-]*[A-Z])(?=[A-Za-z0-9-]*[A-Z0-9]{2})[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b")


def split_units(answer: str) -> list[str]:
    """Tách câu trả lời thành các câu/gạch đầu dòng. Bỏ dòng bảng markdown và tiêu đề."""
    units = []
    for line in answer.splitlines():
        line = line.strip()
        if not line or line.startswith("|") or line.startswith("#"):
            continue
        line = re.sub(r"^([-*•]|\d+[.)])\s+", "", line)
        if _META.match(line) or _BOLD_LINE.match(line):
            continue  # cả dòng là ghi chú/giới hạn/disclaimer hoặc tiêu đề in đậm
        for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z(\"'])", line):
            if sent.strip():
                units.append(sent.strip())
    return units


def _norm_num(n: str) -> str:
    return n.replace(",", "")


def _evidence_numbers(text: str) -> set[str]:
    return {_norm_num(n) for n in _NUM.findall(text)}


_SUBSCRIPT = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_CHEM = {"O2": "oxygen", "N2": "nitrogen", "CO2": "carbon dioxide", "He": "helium", "SF6": "sulfur hexafluoride",
         "Xe": "xenon", "H2": "hydrogen", "CO": "carbon monoxide"}


def _term_in(term: str, ev_low: str) -> bool:
    """Thuật ngữ có trong nguồn không – chấp nhận biến thể: FLEX-1≈FLEX, O2≈oxygen, BASS/Saffire-II≈gạch nối."""
    t = term.lower()
    if t in ev_low or t.replace("-", " ") in ev_low or t.replace("-", "") in ev_low:
        return True
    if term in _CHEM and _CHEM[term] in ev_low:
        return True
    base = re.sub(r"-(1|i)$", "", t)  # FLEX-1 = FLEX (thế hệ đầu không ghi số)
    return base != t and re.search(rf"\b{re.escape(base)}\b(?!-)", ev_low) is not None


_TERM_SKIP = {"NASA", "ISS", "PSI", "NTRS", "US", "USA", "UK", "PI", "PIS", "CO", "II", "III", "IV"}
# tên nguồn model ghi trong câu (NASA-RG-2015, SPINOFF-AIR-TANKS…) và chữ viết tắt trong ngoặc ngay sau cụm từ
_SOURCE_ID = re.compile(r"\b(?:NASA|SPINOFF|NTRS|PSI)(?:-[A-Z0-9]+)+\b")
_PAREN_ABBR = re.compile(r"\(([A-Z][A-Z0-9-]{1,10})\)")


def check_sentence(sentence: str, evidence_text: str) -> dict:
    evidence_text = evidence_text.translate(_SUBSCRIPT)
    claim = _TAG.sub(" ", sentence).translate(_SUBSCRIPT)
    claim_no_ids = re.sub(r"\bPSI-\d+\b|\bNTRS[- ]?\d+\b|\bpp?\.\s*\d+(?:\s*[,–-]\s*\d+)*", " ", claim, flags=re.I)
    claim_no_ids = _PAREN_ABBR.sub(" ", _SOURCE_ID.sub(" ", claim_no_ids))
    # tách cả từ có gạch nối ("pure-oxygen" -> pure, oxygen) ở cả hai phía
    ev_tokens = set(tokenize(evidence_text)) | set(tokenize(evidence_text.replace("-", " ")))
    claim_words = re.sub(r"\*\*[^*]{1,60}:\*\*", " ", claim_no_ids).replace("-", " ")  # bỏ nhãn đậm "**X:**"
    words = [t for t in tokenize(claim_words) if len(t) >= 3 and not t.isdigit() and t not in _GENERIC]
    words = list(dict.fromkeys(words))
    matched = [w for w in words if w in ev_tokens or (_SYN.get(w, set()) & ev_tokens)]
    overlap = len(matched) / len(words) if words else 1.0

    ev_nums = _evidence_numbers(evidence_text)
    ev_low = evidence_text.lower()
    missing_numbers = [n for n in dict.fromkeys(_NUM.findall(claim_no_ids))
                       if _norm_num(n) not in ev_nums and n not in ev_low]
    missing_terms = [t for t in dict.fromkeys(_TERM.findall(claim_no_ids))
                     if t not in _TERM_SKIP and not _term_in(t, ev_low)]

    if overlap < WEAK_MIN:
        status = "unsupported"
    elif overlap < SUPPORTED_MIN or missing_numbers or missing_terms:
        status = "weak"
    else:
        status = "supported"
    return {"overlap": round(overlap, 2), "missing_numbers": missing_numbers, "missing_terms": missing_terms,
            "unmatched_words": [w for w in words if w not in matched][:8], "status": status}


# từ báo hiệu suy luận / khái quát hóa vượt khỏi bằng chứng
_INFERENCE = re.compile(
    r"\b(therefore|thus|hence|consequently|suggests?|suggesting|impl(?:y|ies|ying)|likely|unlikely|probably|"
    r"presumably|reflects?|this means|which means|indicat(?:es|ing) that|it follows|in general|generally|"
    r"always|never|all|none|every|universally|in all cases|regardless)\b", re.I)
_INTERP = re.compile(r"^(\*\*)?\s*interpretation\b", re.I)  # suy luận model tự đánh dấu (prompt rule 12)
_QUOTED = re.compile(r"[\"“][^\"”]*[\"”]")
_RANK = {"supported": 2, "weak": 1, "unsupported": 0}


def _best_refs(sentence: str, evidence: dict[str, str], top: int = 2) -> tuple[list[str], dict]:
    """Nguồn nào trong toàn bộ context ủng hộ câu này tốt nhất (để gợi ý tag đúng)."""
    scored = []
    for ref, text in evidence.items():
        r = check_sentence(sentence, text)
        scored.append((_RANK[r["status"]], r["overlap"], ref, r))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [x[2] for x in scored[:top] if x[0] == 2], (scored[0][3] if scored else {})


def verify_answer(answer: str, evidence: dict[str, str]) -> dict:
    """evidence: nhãn ('S1') -> toàn văn MỌI nguồn đã truy xuất trong lượt (kể cả không được trích).

    Trả về tổng hợp + chi tiết từng câu:
      status          citation correctness: supported | weak | unsupported | uncited
      context_status  faithfulness vs toàn bộ context: supported | weak | unsupported
      miscited        True khi nguồn gắn tag không ủng hộ nhưng nguồn khác trong context có
      suggested_refs  tag nên dùng (khi miscited)
      inference       các từ suy luận/khái quát hóa tìm thấy -> cần người đọc kiểm lại
    """
    sentences = []
    counts = {"supported": 0, "weak": 0, "unsupported": 0, "uncited": 0}
    faith = {"supported": 0, "weak": 0, "unsupported": 0}
    miscited = inference = 0
    all_text = "\n".join(evidence.values())
    for unit in split_units(answer):
        if _META.match(unit):
            continue
        refs = list(dict.fromkeys(_TAG.findall(unit)))
        if not refs and (len(unit.split()) < 8 or unit.lower().startswith(("limitation", "note", "**"))):
            continue  # tiêu đề / ghi chú ngắn, không phải khẳng định
        texts = [evidence[r] for r in refs if r in evidence]
        if refs and not texts:
            continue
        ctx = check_sentence(unit, all_text)
        if refs:
            res = check_sentence(unit, "\n".join(texts))
        else:
            res = {**ctx, "status": "uncited"}
        item = {"text": unit[:400], "refs": refs, **res,
                "context_status": ctx["status"], "context_overlap": ctx["overlap"],
                "miscited": False, "suggested_refs": [],
                "inference": sorted({m.lower() for m in _INFERENCE.findall(_QUOTED.sub(" ", _TAG.sub(" ", unit)))}
                                    | ({"interpretation"} if _INTERP.match(unit) else set()))}
        if res["status"] in ("weak", "unsupported", "uncited") and _RANK[ctx["status"]] >= _RANK["weak"]:
            best, _ = _best_refs(unit, evidence)
            best = [b for b in best if b not in refs]
            if best:
                item["suggested_refs"] = best
                item["miscited"] = res["status"] != "uncited"
        counts[res["status"]] += 1
        faith[ctx["status"]] += 1
        miscited += item["miscited"]
        inference += bool(item["inference"])
        sentences.append(item)
    checked = counts["supported"] + counts["weak"] + counts["unsupported"]
    claims = len(sentences)
    return {
        "checked": checked, **counts, "sentences": sentences,
        "claims": claims, "miscited": miscited, "inference": inference,
        "faithfulness": {**faith, "score": round(faith["supported"] / claims, 2) if claims else None},
        "citation_correctness": round(counts["supported"] / checked, 2) if checked else None,
    }
