"""Nạp tài liệu nguồn -> data/processed/chunks.jsonl.

Cách dùng:
  1. Bỏ file .txt / .md / .pdf vào data/raw/
  2. Khai báo nguồn trong data/raw/sources.csv (cột: filename,source_id,title,url)
     vd: psi69_page.txt,PSI-69,FLEX investigation page,https://psi.nasa.gov/physci/repo/data/investigations/PSI-69
  3. python -m assistant.ingest
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

from . import config

RAW_DIR = config.DATA_DIR / "raw"
CHUNK_CHARS = 1000
OVERLAP_CHARS = 150


def read_units(path: Path) -> list[tuple[str, str]]:
    """Trả về các (section, text): PDF -> mỗi trang 1 unit ("p. N"); markdown -> mỗi heading 1 unit."""
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        units = []
        for i, page in enumerate(PdfReader(str(path)).pages, 1):
            text = re.sub(r"[ \t]+\n", "\n", page.extract_text() or "")
            text = re.sub(r"(?<![.:;!?])\n(?=[a-z(])", " ", text)  # nối dòng bị ngắt giữa câu
            if len(text.strip()) > 80:
                units.append((f"p. {i}", text))
        return units
    units, section, buf = [], "", []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            if "\n".join(buf).strip():
                units.append((section, "\n".join(buf)))
            section, buf = m.group(2).strip(), []
        elif not line.startswith("Source: http"):
            buf.append(line)
    if "\n".join(buf).strip():
        units.append((section, "\n".join(buf)))
    return units


def split_text(text: str, size: int = CHUNK_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Cắt theo đoạn văn, gộp đến ~size ký tự, chồng lấn `overlap` ký tự giữa các chunk."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        while len(p) > size:  # đoạn quá dài -> cắt cứng
            chunks.append(p[:size])
            p = p[size - overlap:]
        if len(buf) + len(p) + 1 > size and buf:
            chunks.append(buf)
            buf = buf[-overlap:] + "\n" + p
        else:
            buf = f"{buf}\n{p}" if buf else p
    if buf:
        chunks.append(buf)
    return chunks


def load_sources() -> dict[str, dict]:
    """Gộp mọi sources.csv trong data/raw (kể cả thư mục con). Khóa = đường dẫn tương đối so với data/raw."""
    out: dict[str, dict] = {}
    for path in sorted(RAW_DIR.rglob("sources.csv")):
        base = path.parent.relative_to(RAW_DIR)
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                key = r["filename"] if "/" in r["filename"] else str(base / r["filename"])
                out[key.removeprefix("./")] = r
    return out


_REF_HEADINGS = re.compile(r"^\s*(references|bibliography|literature cited)\s*$", re.I | re.M)


def drop_reference_pages(units: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """PDF bài báo: bỏ từ trang có tiêu đề 'References' trở đi (danh mục tham khảo gây nhiễu BM25)."""
    for i, (_, text) in enumerate(units):
        m = _REF_HEADINGS.search(text)
        if m and i >= len(units) // 2:
            head = text[:m.start()]
            return units[:i] + ([(units[i][0], head)] if head.strip() else [])
    return units


def main() -> int:
    sources = load_sources()
    files = sorted(p for p in RAW_DIR.rglob("*") if p.suffix.lower() in {".txt", ".md", ".pdf"})
    if not files:
        print(f"Không có file nào trong {RAW_DIR}. Bỏ tài liệu vào đó rồi chạy lại.")
        return 1
    config.CHUNKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(config.CHUNKS_FILE, "w", encoding="utf-8") as out:
        for path in files:
            rel = str(path.relative_to(RAW_DIR))
            meta = sources.get(rel, {})
            if not meta:
                print(f"  ! {rel} chưa có trong sources.csv -> source_id = tên file (nên bổ sung)")
            source_id = meta.get("source_id") or path.stem
            try:
                units = read_units(path)
            except Exception as e:  # PDF hỏng/không đọc được -> bỏ qua, không dừng cả quá trình
                print(f"  ! {rel}: không đọc được ({type(e).__name__}: {e})")
                continue
            if path.suffix.lower() == ".pdf":
                units = drop_reference_pages(units)
            i = 0
            for section, unit in units:
                for text in split_text(unit):
                    if len(text.strip()) < 40:  # bỏ mẩu quá ngắn (nhãn ảnh, nút bấm...)
                        continue
                    i += 1
                    out.write(json.dumps({
                        "id": f"{source_id}#{i}", "source_id": source_id,
                        "title": meta.get("title") or path.stem, "url": meta.get("url", ""),
                        "section": section, "text": text.strip(), "is_mock": False,
                    }, ensure_ascii=False) + "\n")
            n += i
            if i == 0 and path.suffix.lower() == ".pdf":
                print(f"  ! {rel}: không trích được chữ (có thể là PDF scan) -> cần OCR")
            print(f"  + {rel} -> {source_id} ({i} chunks)")
    print(f"Đã ghi {n} chunk vào {config.CHUNKS_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
