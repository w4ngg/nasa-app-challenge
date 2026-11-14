"""Tải PDF các bài báo/báo cáo của 24 nghiên cứu PSI Combustion Science từ NASA NTRS.

  python scripts/fetch_ntrs.py              # cần chạy scripts/fetch_sources.py trước (dùng psi_combustion.json)
  python scripts/fetch_ntrs.py --no-download   # chỉ dò, không tải PDF
  python -m assistant.ingest                # nạp vào chatbot

Cách làm: lấy danh sách "Publication Title" của từng nghiên cứu PSI -> tìm trên NTRS
(https://ntrs.nasa.gov/api/citations/search, API công khai) -> chỉ nhận kết quả khi tên bài khớp
>= MATCH_THRESHOLD -> tải PDF công khai về data/raw/ntrs/.

Kết quả:
  data/raw/ntrs/NTRS-<id>.pdf
  data/raw/ntrs/sources.csv     metadata cho ingest
  data/raw/ntrs/ntrs_index.csv  bảng PSI <-> NTRS (cả bài không tìm thấy / không có PDF) – dùng cho Module 1/2
"""
from __future__ import annotations

import csv
import difflib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = RAW / "ntrs"
NTRS = "https://ntrs.nasa.gov"
UA = {"User-Agent": "Mozilla/5.0 (compatible; spaceapps-research-script)"}
MATCH_THRESHOLD = 0.92
MAX_PDF_MB = 40
DELAY_S = 0.5


def get(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def norm(t: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", t.lower()).split())


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def search(title: str) -> list[dict]:
    q = urllib.parse.urlencode({"q": title[:250], "page.size": 5})
    return json.loads(get(f"{NTRS}/api/citations/search?{q}")).get("results", [])


def pdf_link(rec: dict) -> str | None:
    for d in rec.get("downloads") or []:
        if d.get("mimetype") == "application/pdf":
            link = (d.get("links") or {}).get("pdf") or (d.get("links") or {}).get("original")
            if link:
                return NTRS + link if link.startswith("/") else link
    return None


def main() -> int:
    download = "--no-download" not in sys.argv
    psi_file = RAW / "psi_combustion.json"
    if not psi_file.exists():
        print("Thiếu data/raw/psi_combustion.json – chạy scripts/fetch_sources.py trước.")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    # title -> danh sách PSI chứa bài đó
    title_psi: dict[str, list[str]] = {}
    for h in json.loads(psi_file.read_text(encoding="utf-8"))["hits"]["hits"]:
        s = h["_source"]
        label = f"{s['Accession']} {s.get('Acronym') or ''}".strip()
        for t in re.split(r"\s{3,}", s.get("Publication Title") or ""):
            if t.strip():
                title_psi.setdefault(t.strip(), []).append(label)

    index_rows, sources, seen = [], [], {}
    for i, (title, psis) in enumerate(sorted(title_psi.items()), 1):
        row = {"psi": "; ".join(psis), "publication_title": title, "ntrs_id": "", "ntrs_title": "",
               "match": "", "sti_type": "", "pdf": "", "status": "not_found"}
        try:
            results = search(title)
        except Exception as e:
            row["status"] = f"error: {type(e).__name__}"
            index_rows.append(row)
            continue
        best = max(results, key=lambda r: similarity(title, r.get("title", "")), default=None)
        score = similarity(title, best.get("title", "")) if best else 0.0
        if best and score >= MATCH_THRESHOLD:
            nid = str(best["id"])
            link = pdf_link(best)
            row.update(ntrs_id=nid, ntrs_title=best.get("title", ""), match=f"{score:.2f}",
                       sti_type=best.get("stiType", ""), pdf=link or "",
                       status="no_pdf" if not link else "found")
            fname = f"NTRS-{nid}.pdf"
            if link and download:
                path = OUT / fname
                if nid in seen or path.exists():
                    row["status"] = "downloaded"
                else:
                    try:
                        data = get(link, timeout=180)
                        if len(data) > MAX_PDF_MB * 1e6 or not data.startswith(b"%PDF"):
                            row["status"] = "skipped_size_or_not_pdf"
                        else:
                            path.write_bytes(data)
                            row["status"] = "downloaded"
                    except Exception as e:
                        row["status"] = f"download_error: {type(e).__name__}"
                if row["status"] == "downloaded" and nid not in seen:
                    seen[nid] = True
                    sources.append({"filename": f"ntrs/{fname}", "source_id": f"NTRS-{nid}",
                                    "title": f"{best.get('title', '')} [NTRS {nid}; related: {', '.join(psis)}]",
                                    "url": f"{NTRS}/citations/{nid}", "pdf_url": link})
        index_rows.append(row)
        print(f"[{i}/{len(title_psi)}] {row['status']:<12} {score:.2f} {title[:70]}")
        time.sleep(DELAY_S)

    with open(OUT / "ntrs_index.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(index_rows[0].keys()))
        w.writeheader()
        w.writerows(index_rows)
    with open(OUT / "sources.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["filename", "source_id", "title", "url", "pdf_url"])
        w.writeheader()
        w.writerows(sources)

    from collections import Counter
    print("\nTổng kết:", dict(Counter(r["status"] for r in index_rows)))
    print(f"PDF đã tải: {len(sources)} -> {OUT}\nTiếp theo: python -m assistant.ingest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
