"""Kiểm tra trích dẫn có thật sự ủng hộ câu trả lời không (heuristic, KHÔNG gọi LLM, miễn phí).

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

_TAG = re.compile(r"\[([SIP]\d+)\]")
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
_META = re.compile(r"^(\*\*)?\s*(limitations?|note|caveat)s?\b", re.I)
_NUM = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)*")
_TERM = re.compile(r"\b(?=[A-Za-z0-9-]*[A-Z])(?=[A-Za-z0-9-]*[A-Z0-9]{2})[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b")


def split_units(answer: str) -> list[str]:
    """Tách câu trả lời thành các câu/gạch đầu dòng. Bỏ dòng bảng markdown và tiêu đề."""
    units = []
    for line in answer.splitlines():
        line = line.strip()
        if not line or line.startswith("|") or line.startswith("#"):
            continue
        line = re.sub(r"^([-*•]|\d+[.)])\s+", "", line)
        for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z(\"'])", line):
            if sent.strip():
                units.append(sent.strip())
    return units


def _norm_num(n: str) -> str:
    return n.replace(",", "")


def _evidence_numbers(text: str) -> set[str]:
    return {_norm_num(n) for n in _NUM.findall(text)}


_TERM_SKIP = {"NASA", "ISS", "PSI", "NTRS", "US", "USA", "UK", "PI", "PIS", "CO", "II", "III", "IV"}
# tên nguồn model ghi trong câu (NASA-RG-2015, SPINOFF-AIR-TANKS…) và chữ viết tắt trong ngoặc ngay sau cụm từ
_SOURCE_ID = re.compile(r"\b(?:NASA|SPINOFF|NTRS|PSI)(?:-[A-Z0-9]+)+\b")
_PAREN_ABBR = re.compile(r"\(([A-Z][A-Z0-9-]{1,10})\)")


def check_sentence(sentence: str, evidence_text: str) -> dict:
    claim = _TAG.sub(" ", sentence)
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
                     if t not in _TERM_SKIP and t.lower() not in ev_low and t.lower().replace("-", " ") not in ev_low]

    if overlap < WEAK_MIN:
        status = "unsupported"
    elif overlap < SUPPORTED_MIN or missing_numbers or missing_terms:
        status = "weak"
    else:
        status = "supported"
    return {"overlap": round(overlap, 2), "missing_numbers": missing_numbers, "missing_terms": missing_terms,
            "unmatched_words": [w for w in words if w not in matched][:8], "status": status}


def verify_answer(answer: str, evidence: dict[str, str]) -> dict:
    """evidence: nhãn ('S1') -> toàn văn nguồn đã đưa cho LLM. Trả về tổng hợp + chi tiết từng câu."""
    sentences = []
    counts = {"supported": 0, "weak": 0, "unsupported": 0, "uncited": 0}
    for unit in split_units(answer):
        if _META.match(unit):
            continue
        refs = list(dict.fromkeys(_TAG.findall(unit)))
        if not refs:
            # câu không có nhãn: chỉ đếm khi trông như một khẳng định (đủ dài, không phải tiêu đề/ghi chú)
            if len(unit.split()) >= 8 and not unit.lower().startswith(("limitation", "note", "**")):
                counts["uncited"] += 1
            continue
        texts = [evidence[r] for r in refs if r in evidence]
        if not texts:
            continue
        res = check_sentence(unit, "\n".join(texts))
        counts[res["status"]] += 1
        sentences.append({"text": unit[:400], "refs": refs, **res})
    checked = counts["supported"] + counts["weak"] + counts["unsupported"]
    return {"checked": checked, **counts, "sentences": sentences}
