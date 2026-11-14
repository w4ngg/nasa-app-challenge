"""Tải các nguồn dữ liệu chính thức của đề Flame in Freefall vào data/raw/.

  python scripts/fetch_sources.py            # tải tất cả
  python -m assistant.ingest                 # sau đó nạp vào chatbot

Kết quả:
  data/raw/PSI-xx.md            1 file / investigation (metadata PSI, 24 nghiên cứu Combustion Science)
  data/raw/psi_combustion.json  bản gốc từ API PSI (để tái lập / cho Module 1)
  data/raw/researchers_guide.pdf
  data/raw/<web>.md             các trang NASA trong mục "NASA Data & Resources" của đề
  data/raw/sources.csv          metadata nguồn cho ingest
  data/investigations.csv       bảng investigations (khởi điểm cho Module 1; cột O2/áp suất/airflow để trống
                                vì metadata PSI không có – cần trích từ tài liệu/data files)

Ghi chú: API /geode-py/ws/repo/search là API nội bộ của web PSI (không phải API công bố chính thức).
Dữ liệu được lưu lại để demo không phụ thuộc mạng.
"""
from __future__ import annotations

import csv
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
UA = {"User-Agent": "Mozilla/5.0 (compatible; spaceapps-research-script)"}

PSI_SEARCH = ("https://psi.nasa.gov/geode-py/ws/repo/search?"
              + urllib.parse.urlencode({"ffield": "Research Area", "fvalue": "combustion science", "size": 200}))
PSI_PAGE = "https://psi.nasa.gov/physci/repo/data/investigations/{}"
GUIDE_PDF = ("https://www.nasa.gov/wp-content/uploads/2016/05/"
             "np-2015-10-034-jsc_combustion_in_reduced_gravity-iss-mini-book-011116-508.pdf")
GUIDE_PAGE = "https://www.nasa.gov/missions/station/a-researchers-guide-to-combustion-science/"
CS = "https://www.nasa.gov/glenn/glenn-expertise-space-exploration/physical-sciences-program/combustion-science/"

# (file, source_id, title, url, start_marker) – start_marker: đoạn text bắt đầu nội dung chính (None = giữ hết)
# Link MDCA trên trang Combustion Science bị 404 (kiểm tra 2026-11-14); nội dung MDCA đã có trên trang chính.
WEB_PAGES = [
    ("nasa_combustion_science.md", "NASA-COMBUSTION-SCIENCE", "NASA Combustion Science (Glenn Research Center)", CS,
     "In the United States, combustion processes"),
    ("nasa_cs_flare.md", "NASA-CS-FLARE", "Flammability Limits at Reduced-g Experiment (FLARE)",
     CS + "flammability-limits-at-reduced-g-experiment-flare/", None),
    ("nasa_cs_fm2.md", "NASA-CS-FM2", "Flammability of Materials on the Moon (FM2)",
     CS + "flammability-of-materials-on-the-moon-fm2/", None),
    ("nasa_cs_sofie.md", "NASA-CS-SOFIE", "Solid Fuel Ignition and Extinction (SoFIE)",
     CS + "solid-fuel-ignition-and-extinction-sofie/", None),
    ("guide_landing.md", "NASA-RG-PAGE", "A Researcher's Guide to ISS Combustion Science (landing page)", GUIDE_PAGE, None),
    ("apollo1.md", "NASA-APOLLO-1", "Apollo 1 – fire, investigation and lessons learned",
     "https://sma.nasa.gov/sma-disciplines/accllp/apollo-1", "First Apollo Mission Commences"),
    ("apollo13.md", "NASA-APOLLO-13", "Apollo 13 – oxygen tank explosion and lessons learned",
     "https://sma.nasa.gov/sma-disciplines/accllp/apollo-13", None),
    ("mir_fire.md", "NASA-MIR-1997", "25 Years Ago: Fire Aboard Space Station Mir",
     "https://www.nasa.gov/history/25-years-ago-fire-aboard-space-station-mir/", None),
    ("spinoff_air_tanks.md", "SPINOFF-AIR-TANKS", "Spinoff: Fireman's Air Tanks", "https://spinoff.nasa.gov/node/9582", None),
    ("spinoff_fire_detector.md", "SPINOFF-FIRE-DETECTOR", "Spinoff: Fire Detector", "https://spinoff.nasa.gov/node/9407", None),
    ("spinoff_fire_attire.md", "SPINOFF-FIRE-ATTIRE", "Spinoff: New Technology for the Fire Attire",
     "https://spinoff.nasa.gov/node/9918", None),
]


def get(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


# ---------------- HTML -> markdown (đơn giản, đủ cho trang NASA) ----------------
# Không xóa <form>: trang sma.nasa.gov bọc toàn bộ nội dung trong <form>.
_DROP = r"(?is)<(script|style|noscript|svg|nav|header|footer|aside|button|iframe)\b.*?</\1>"


def html_to_md(raw: str) -> str:
    m = re.search(r"(?is)<main\b.*?>(.*)</main>", raw) or re.search(r"(?is)<article\b.*?>(.*)</article>", raw)
    body = m.group(1) if m else raw
    body = re.sub(_DROP, " ", body)
    body = re.sub(r"(?is)<h([1-4])[^>]*>(.*?)</h\1>",
                  lambda x: "\n\n" + "#" * int(x.group(1)) + " " + re.sub(r"<[^>]+>", "", x.group(2)).strip() + "\n\n", body)
    body = re.sub(r"(?is)<li[^>]*>", "\n- ", body)
    body = re.sub(r"(?is)</?(p|div|section|br|tr|table|ul|ol|figure|figcaption|blockquote)[^>]*>", "\n\n", body)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in body.splitlines()]
    out = "\n".join(lines)
    out = re.sub(r"\n- \s*\n", "\n", out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def clean_nasa_page(md: str, start_marker: str | None = None) -> str:
    """Bỏ phần menu/điều hướng ở đầu (cắt tới `start_marker` nếu có) và phần 'Keep Exploring' cuối trang."""
    if start_marker and start_marker in md:
        md = md[md.find(start_marker):]
    elif "\n# " in md and md.find("\n# ") < 400:  # menu ngắn trước H1 (spinoff, nasa.gov)
        md = md[md.find("\n# ") + 1:]
    md = re.sub(r"(?m)^(-|#+)\s*$\n?", "", md)  # bỏ bullet / heading rỗng
    md = re.sub(r"\n{3,}", "\n\n", md)
    # Cuối trang: mục liên quan / tưởng niệm / danh sách media (trang Apollo 13 còn chèn nhầm nội dung Apollo 1 sau mục Tributes)
    for stop in ("\n## Keep Exploring", "\nKeep Exploring", "\n## Related Terms", "\n## Related Stories",
                 "\n## Discover More Topics", "\nShare\n\nDetails\n", "\nDetails\n\nLast Updated",
                 "\nMemorials and Tributes", "\n## Apollo 13\nTributes", "\nResources\n\nNASA\nReport"):
        j = md.find(stop)
        if j > 0:
            md = md[:j]
    return md.strip()


# ---------------- PSI ----------------
def _multi(v: str) -> list[str]:
    return [x.strip() for x in re.split(r"\s{3,}", v or "") if x.strip()]


def psi_to_md(s: dict) -> str:
    acc, acr = s.get("Accession", ""), s.get("Acronym", "")
    title = s.get("Title", "")
    p = s.get("Person") or {}
    # PSI ghép nhiều người thành chuỗi song song: First="Richard Peter", Last="Axelbaum Sunderland"
    firsts, lasts = (p.get("First Name") or "").split(), (p.get("Last Name") or "").split()
    mids = (p.get("Middle Initials") or "").split()
    if len(firsts) == len(lasts):
        mids = mids if len(mids) == len(firsts) else [""] * len(firsts)
        pi = ", ".join(" ".join(x for x in (f, m, l) if x) for f, m, l in zip(firsts, mids, lasts))
    else:  # không khớp số lượng -> giữ nguyên, tránh ghép sai người
        pi = f"{p.get('First Name', '')} / {p.get('Last Name', '')}"
    hw = s.get("Experiment Hardware") or {}
    hw_name = hw.get("Name", "") if isinstance(hw, dict) else str(hw)
    meta = [
        f"- PSI accession: {acc}", f"- Acronym: {acr or '—'}", f"- Research area: {s.get('Research Area', '')}",
        f"- Sub-area: {s.get('SubResearch Area', '') or '—'}", f"- Project type: {s.get('Project Type', '')}",
        f"- Flight platform: {s.get('Flight Platform', '') or '—'}", f"- Hardware: {hw_name or '—'}",
        f"- Principal investigator: {pi or '—'}",
        f"- Period: {s.get('Investigation Start Date', '')} to {s.get('Investigation End Date', '')}",
        f"- Monitoring center: {s.get('Monitoring Center', '') or '—'}",
        f"- Keywords: {', '.join(_multi(s.get('Keywords', '')))}",
        f"- Related investigations: {', '.join(_multi(s.get('Related Investigations', ''))) or '—'}",
        f"- PSI page: {PSI_PAGE.format(acc)}",
    ]
    parts = [f"# {acc} {acr} – {title}".replace("  ", " "), "## Overview", "\n".join(meta)]
    for field in ("Objectives", "Hypothesis", "Approach", "Research Impacts/Earth Benefits"):
        if s.get(field):
            parts += [f"## {field}", str(s[field]).strip()]
    pubs = _multi(s.get("Publication Title", ""))
    if pubs:
        parts += ["## Publications", "\n".join(f"- {t}" for t in pubs)]
    return "\n\n".join(parts) + "\n"


def fetch_psi(sources: list[dict]) -> list[dict]:
    data = json.loads(get(PSI_SEARCH))
    (RAW / "psi_combustion.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    rows = [h["_source"] for h in data["hits"]["hits"]]
    for s in rows:
        acc = s["Accession"]
        fname = f"{acc}.md"
        (RAW / fname).write_text(psi_to_md(s), encoding="utf-8")
        title = f"{acc} {s.get('Acronym') or ''} – {s.get('Title', '')}".replace("  ", " ")
        sources.append({"filename": fname, "source_id": acc, "title": title, "url": PSI_PAGE.format(acc)})
    print(f"  PSI: {len(rows)} combustion investigations (API total={data['hits']['total']})")
    return rows


def write_investigations_csv(rows: list[dict]) -> None:
    """Bảng khởi điểm cho Module 1, theo schema trong assistant/integrations.py."""
    out = ROOT / "data" / "investigations.csv"
    fields = ["psi_id", "doi", "name", "acronym", "year", "hardware", "fuel_type", "material", "o2_min", "o2_max",
              "pressure_kpa", "airflow_cm_s", "gravity", "has_results", "sub_area", "project_type", "keywords",
              "description", "link"]
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for s in sorted(rows, key=lambda r: int(r["Accession"].split("-")[1])):
            hw = s.get("Experiment Hardware") or {}
            ptype = s.get("Project Type", "")
            w.writerow({
                "psi_id": s["Accession"], "name": s.get("Title", ""), "acronym": s.get("Acronym", ""),
                "year": (s.get("Investigation Start Date") or "")[-4:],
                "hardware": hw.get("Name", "") if isinstance(hw, dict) else hw,
                "gravity": "microgravity" if "Microgravity" in ptype else ("ground" if "Ground" in ptype else ptype),
                "sub_area": s.get("SubResearch Area", ""), "project_type": ptype,
                "keywords": ", ".join(_multi(s.get("Keywords", ""))),
                "description": re.sub(r"\s+", " ", s.get("Objectives", ""))[:600],
                "link": PSI_PAGE.format(s["Accession"]),
            })
    print(f"  investigations.csv: {len(rows)} rows -> {out}")


def fetch_guide(sources: list[dict]) -> None:
    (RAW / "researchers_guide.pdf").write_bytes(get(GUIDE_PDF, timeout=120))
    sources.append({"filename": "researchers_guide.pdf", "source_id": "NASA-RG-2015",
                    "title": "A Researcher's Guide to International Space Station Combustion Science (NASA, 2015)",
                    "url": GUIDE_PDF})
    print("  Researcher's Guide PDF: ok")


def fetch_web(sources: list[dict]) -> None:
    for fname, sid, title, url, start in WEB_PAGES:
        try:
            md = clean_nasa_page(html_to_md(get(url).decode("utf-8", errors="ignore")), start)
        except Exception as e:
            print(f"  ! {sid}: {type(e).__name__}: {e}")
            continue
        if len(md) < 500:
            print(f"  ! {sid}: chỉ trích được {len(md)} ký tự – kiểm tra tay trang này")
        (RAW / fname).write_text(f"Source: {url}\n\n{md}\n", encoding="utf-8")
        sources.append({"filename": fname, "source_id": sid, "title": title, "url": url})
        print(f"  web {sid}: {len(md):,} chars")


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    sources: list[dict] = []
    rows = fetch_psi(sources)
    write_investigations_csv(rows)
    fetch_guide(sources)
    fetch_web(sources)
    with open(RAW / "sources.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["filename", "source_id", "title", "url"])
        w.writeheader()
        w.writerows(sources)
    print(f"Done: {len(sources)} sources -> {RAW / 'sources.csv'}\nNext: python -m assistant.ingest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
