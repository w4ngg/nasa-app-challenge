"""Tìm bản truy cập mở (open access) hợp pháp cho các bài báo PSI chưa có PDF, qua OpenAlex.

  python scripts/fetch_openalex.py                 # dò + tải PDF open access về data/raw/oa/
  python scripts/fetch_openalex.py --no-download   # chỉ dò, không tải
  python -m assistant.ingest                       # nạp vào chatbot

Đầu vào: data/raw/ntrs/ntrs_index.csv (bài chưa tải được từ NTRS) + DOI lấy từ knowledge graph của nhóm
(apps/web/public/data/graph.json, --graph để đổi đường dẫn). Bài chưa có DOI -> tìm theo tên trên OpenAlex,
chỉ nhận khi tên khớp >= MATCH_THRESHOLD.

OpenAlex (https://api.openalex.org) gộp dữ liệu open access của Unpaywall. Không có key thì chỉ có một ngân sách
nhỏ mỗi ngày, dùng chung theo địa chỉ IP (reset 00:00 UTC). Hết ngân sách (HTTP 429) -> tự chuyển sang
Semantic Scholar (https://api.semanticscholar.org, không cần key, ~1 request/giây, tự chờ khi bị 429).
Chạy lại script sẽ tiếp tục: bài đã tải / đã xác nhận "closed" được giữ, chỉ dò lại bài lỗi hoặc chưa tải được.
Chỉ tải các "location" OpenAlex đánh dấu is_oa kèm pdf_url (bản của nhà xuất bản open access, PubMed Central,
arXiv, kho lưu trữ của trường...). Không vượt paywall, không dùng nguồn lậu.

License: cột `license` (vd cc-by, public-domain) và `redistributable` trong sources.csv. Chỉ bài có license mở
(Creative Commons / public domain) được đưa vào snapshot dữ liệu commit lên repo (scripts/export_snapshot.py);
bài chỉ "đọc miễn phí" (bronze, không license) dùng local.

Kết quả:
  data/raw/oa/OA-<openalex id>.pdf   (không commit)
  data/raw/oa/sources.csv            metadata cho ingest (có license)
  data/raw/oa/oa_index.csv           mọi bài đã dò: DOI, trạng thái open access, lý do không tải được
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = RAW / "oa"
API = "https://api.openalex.org"
UA = {"User-Agent": "Mozilla/5.0 (compatible; spaceapps-research-script)"}
MATCH_THRESHOLD = 0.92
MAX_PDF_MB = 40
DELAY_S = 0.15
DEFAULT_GRAPH = ROOT.parent / "nasa-app-challenge" / "apps" / "web" / "public" / "data" / "graph.json"
S2 = "https://api.semanticscholar.org/graph/v1"
S2_FIELDS = "title,isOpenAccess,openAccessPdf,externalIds,year,venue"
S2_DELAY_S = 1.2
SELECT = "id,doi,title,publication_year,type,open_access,best_oa_location,locations,primary_location"


def norm(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (t or "").lower()).split().__str__()


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def get_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def get_bytes(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={**UA, "Accept": "application/pdf,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(int(MAX_PDF_MB * 1e6) + 1)


def is_open_license(lic: str | None) -> bool:
    lic = (lic or "").lower()
    return lic.startswith("cc") or lic in {"public-domain", "pd", "nasa-ntrs"}


def doi_map(graph_path: Path) -> list[tuple[str, str]]:
    if not graph_path.exists():
        print(f"(không thấy {graph_path} -> chỉ tìm theo tên)")
        return []
    g = json.loads(graph_path.read_text(encoding="utf-8"))
    return [(n.get("title") or n.get("label") or "", n["doi"]) for n in g.get("nodes", [])
            if n.get("type") == "publication" and n.get("doi")]


def find_doi(title: str, dois: list[tuple[str, str]]) -> str | None:
    best = max(dois, key=lambda x: similarity(title, x[0]), default=None)
    return best[1] if best and similarity(title, best[0]) >= MATCH_THRESHOLD else None


def lookup(title: str, doi: str | None) -> tuple[dict | None, str]:
    if doi:
        try:
            return get_json(f"{API}/works/doi:{urllib.parse.quote(doi)}?select={SELECT}"), "doi"
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    q = urllib.parse.urlencode({"search": title[:300], "per-page": 5, "select": SELECT})
    res = get_json(f"{API}/works?{q}").get("results") or []
    best = max(res, key=lambda w: similarity(title, w.get("title") or ""), default=None)
    if best and similarity(title, best.get("title") or "") >= MATCH_THRESHOLD:
        return best, "title"
    return None, "not_found"


def s2_get(url: str, tries: int = 6) -> dict | None:
    """Semantic Scholar không key: giới hạn chung -> chờ tăng dần khi gặp 429."""
    wait = 5
    for _ in range(tries):
        time.sleep(S2_DELAY_S)
        try:
            return get_json(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code != 429:
                raise
            time.sleep(wait)
            wait = min(wait * 2, 60)
    raise RuntimeError("semantic scholar rate limit")


def s2_lookup(title: str, doi: str | None) -> dict | None:
    """Trả về 1 'location' giống OpenAlex ({pdf_url, license, version, source}) hoặc None."""
    p = None
    if doi:
        p = s2_get(f"{S2}/paper/DOI:{urllib.parse.quote(doi)}?fields={S2_FIELDS}")
    if p is None:
        res = s2_get(f"{S2}/paper/search/match?" + urllib.parse.urlencode({"query": title[:300], "fields": S2_FIELDS}))
        cand = (res or {}).get("data") or []
        p = cand[0] if cand and similarity(title, cand[0].get("title") or "") >= MATCH_THRESHOLD else None
    pdf = (p or {}).get("openAccessPdf") or {}
    if not pdf.get("url"):
        return {"_s2": p, "pdf_url": None} if p else None
    lic = (pdf.get("license") or "").lower().replace("ccby", "cc-by").replace("other-oa", "")
    return {"_s2": p, "pdf_url": pdf_url_fix(pdf["url"]), "license": lic, "version": pdf.get("status", "").lower(),
            "source": {"display_name": urllib.parse.urlparse(pdf["url"]).netloc, "type": "repository"},
            "landing_page_url": pdf["url"]}


def pdf_url_fix(url: str) -> str:
    """Một số link là trang giới thiệu: HAL -> /document, arXiv abs -> pdf."""
    if re.search(r"hal\.science/hal-\d+/?$|hal\.archives-ouvertes\.fr/hal-\d+/?$", url):
        return url.rstrip("/") + "/document"
    return re.sub(r"arxiv\.org/abs/", "arxiv.org/pdf/", url)


def oa_candidates(w: dict) -> list[dict]:
    """Các bản open access có link PDF, ưu tiên license mở rồi tới kho lưu trữ (ít chặn bot hơn nhà xuất bản)."""
    locs = [l for l in (w.get("locations") or []) if l.get("is_oa") and l.get("pdf_url")]
    best = w.get("best_oa_location")
    if best and best.get("pdf_url") and best not in locs:
        locs.insert(0, best)
    return sorted(locs, key=lambda l: (not is_open_license(l.get("license")),
                                       ((l.get("source") or {}).get("type") != "repository")))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-download", action="store_true")
    ap.add_argument("--graph", type=Path, default=DEFAULT_GRAPH)
    ap.add_argument("--limit", type=int, default=0, help="chỉ dò N bài đầu (thử nhanh)")
    args = ap.parse_args()

    idx = RAW / "ntrs" / "ntrs_index.csv"
    if not idx.exists():
        print("Thiếu data/raw/ntrs/ntrs_index.csv – chạy scripts/fetch_ntrs.py trước.")
        return 1
    todo = [r for r in csv.DictReader(open(idx, encoding="utf-8")) if r["status"] != "downloaded"]
    if args.limit:
        todo = todo[:args.limit]
    dois = doi_map(args.graph)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{len(todo)} bài chưa có PDF; {len(dois)} DOI từ knowledge graph")

    prev_rows = {r["publication_title"]: r for r in csv.DictReader(open(OUT / "oa_index.csv", encoding="utf-8"))} \
        if (OUT / "oa_index.csv").exists() else {}
    prev_src = {r["source_id"]: r for r in csv.DictReader(open(OUT / "sources.csv", encoding="utf-8"))} \
        if (OUT / "sources.csv").exists() else {}
    rows, sources, seen = [], [], set()
    openalex_ok = True

    def try_download(row: dict, oid: str, loc: dict, wtitle: str, year, via: str) -> bool:
        try:
            data = get_bytes(loc["pdf_url"])
        except Exception as e:
            row["host"] = f"{type(e).__name__}"
            return False
        if not data.startswith(b"%PDF") or len(data) > MAX_PDF_MB * 1e6:
            row["host"] = "not a PDF (landing page / captcha)"
            return False
        fname = f"OA-{oid}.pdf"
        (OUT / fname).write_bytes(data)
        lic = loc.get("license") or ""
        if not lic and urllib.parse.urlparse(loc["pdf_url"]).netloc.endswith("ntrs.nasa.gov"):
            lic = "nasa-ntrs"  # báo cáo NASA trên NTRS: cùng chính sách với các PDF NTRS đã có trong corpus
        src = loc.get("source") or {}
        row.update(status="downloaded", license=lic, version=loc.get("version") or "", matched_by=via,
                   host=src.get("display_name") or urllib.parse.urlparse(loc["pdf_url"]).netloc, pdf=loc["pdf_url"])
        seen.add(oid)
        sources.append({
            "filename": f"oa/{fname}", "source_id": f"OA-{oid}",
            "title": f"{wtitle} [{row['host']} {year or ''}; {lic or 'free to read, no license'}; related: {row['psi']}]",
            "url": (f"https://doi.org/{row['doi']}" if row["doi"] else loc.get("landing_page_url") or loc["pdf_url"]),
            "pdf_url": loc["pdf_url"], "license": lic, "redistributable": "1" if is_open_license(lic) else "0"})
        return True

    for i, r in enumerate(todo, 1):
        title, psis = r["publication_title"], r["psi"]
        old = prev_rows.get(title)
        if old and old["status"] in ("downloaded", "closed", "duplicate") and \
                (old["status"] != "downloaded" or f"OA-{old['openalex_id']}" in prev_src):
            rows.append(old)
            if old["status"] == "downloaded":
                sources.append(prev_src[f"OA-{old['openalex_id']}"])
                seen.add(old["openalex_id"])
            continue
        row = {"psi": psis, "publication_title": title, "doi": find_doi(title, dois) or "", "matched_by": "",
               "openalex_id": "", "oa_status": "", "license": "", "version": "", "host": "", "pdf": "",
               "status": "not_found"}
        w = None
        if openalex_ok:
            try:
                w, how = lookup(title, row["doi"] or None)
                row["matched_by"] = how
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    openalex_ok = False
                    print("  OpenAlex: hết ngân sách miễn phí hôm nay (429) -> chuyển sang Semantic Scholar")
                else:
                    row["status"] = f"openalex_error: {e.code}"
            except Exception as e:
                row["status"] = f"openalex_error: {type(e).__name__}"
        if w:
            oid = (w.get("id") or "").rsplit("/", 1)[-1]
            row.update(openalex_id=oid, doi=(w.get("doi") or row["doi"] or "").replace("https://doi.org/", ""),
                       oa_status=(w.get("open_access") or {}).get("oa_status", ""))
            cands = oa_candidates(w)
            row["status"] = "closed" if not cands else "oa_found"
            if cands and oid in seen:
                row["status"] = "duplicate"
            elif cands and not args.no_download:
                row["status"] = "download_failed"
                for loc in cands:
                    if try_download(row, oid, loc, w.get("title") or title, w.get("publication_year"), "openalex"):
                        break
        # Semantic Scholar: OpenAlex hết ngân sách / không tìm thấy / có OA nhưng nhà xuất bản chặn tải
        if row["status"] not in ("downloaded", "closed", "duplicate"):
            try:
                loc = s2_lookup(title, row["doi"] or None)
            except Exception as e:
                loc = None
                row["status"] = row["status"] if row["status"] != "not_found" else f"s2_error: {type(e).__name__}"
            if loc:
                p = loc["_s2"] or {}
                row["doi"] = row["doi"] or ((p.get("externalIds") or {}).get("DOI") or "").lower()
                sid = row["openalex_id"] or f"S2{(p.get('paperId') or '')[:12]}"
                if not loc["pdf_url"]:
                    row.update(status="closed" if row["status"] in ("not_found",) or row["status"].startswith(("openalex", "s2")) else row["status"],
                               matched_by=row["matched_by"] or "s2")
                elif sid in seen:
                    row["status"] = "duplicate"
                elif not args.no_download:
                    if not try_download(row, sid, loc, p.get("title") or title, p.get("year"), "s2"):
                        row["status"] = "download_failed"
                        row["oa_status"] = row["oa_status"] or loc.get("version", "")
                else:
                    row["status"] = "oa_found"
        rows.append(row)
        print(f"[{i}/{len(todo)}] {row['status']:<15} {row['license'] or '-':<12} {title[:64]}", flush=True)
        if openalex_ok:
            time.sleep(DELAY_S)

    with open(OUT / "oa_index.csv", "w", encoding="utf-8", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)
    with open(OUT / "sources.csv", "w", encoding="utf-8", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=["filename", "source_id", "title", "url", "pdf_url", "license",
                                           "redistributable"])
        wr.writeheader()
        wr.writerows(sources)

    from collections import Counter
    print("\nTổng kết:", dict(Counter(r["status"] for r in rows)))
    print("OA status:", dict(Counter(r["oa_status"] or "-" for r in rows)))
    print(f"PDF đã tải: {len(sources)} ({sum(s['redistributable'] == '1' for s in sources)} có license mở) -> {OUT}")
    print("Tiếp theo: python -m assistant.ingest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
