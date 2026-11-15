"""Build the human-readable research report from the verified PSI inventory."""
import collections
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs/psi-file-audit-2026-11-14"
REPORT = ROOT / "docs/research/psi-data-files-2026-11-14.md"

CATEGORY_NOTES = {
    "Investigation Metadata Files": ("ZIP metadata", "Thông tin hồ sơ theo cấu trúc ISA; các ZIP mẫu có i_Investigation.txt và s_PSI-*.txt. Dùng để lập danh mục, không coi là số đo."),
    "Experimental table": ("CSV", "Bảng điều kiện, chỉ mục test, tổng hợp theo ngày hoặc danh mục hình trong bài báo. Cần xác định đơn vị của mỗi dòng."),
    "Science Documents": ("PDF, DOCX, XLSX", "Yêu cầu khoa học, test plan, README, Data Organization/Interpretation Document; giải thích cách dùng dữ liệu."),
    "Engineering Documents": ("PDF, tài liệu Office", "Thiết kế và cấu hình thiết bị, bản vẽ, đặc tính cảm biến; cần cho diễn giải phép đo và hiệu chuẩn."),
    "Reports": ("PDF, tài liệu báo cáo", "Báo cáo nhiệm vụ, post-flight/final report hoặc luận án; nguồn nội dung tổng hợp và giới hạn."),
    "Presentations": ("PDF, PPT, PPTX", "Bài trình bày; có sơ đồ, biểu đồ và bối cảnh nhưng cần kiểm tra với tài liệu/dữ liệu gốc."),
    "Analyzed Data": ("XLS/XLSX, CSV, DAT, PDF, PXP", "Kết quả xử lý hoặc mô phỏng; có thể là số liệu cho hình, bảng phân bố hạt, logs đã tổng hợp hoặc báo cáo từng run."),
    "Raw Data": ("ZIP, TXT, DAT, CSV, MP4, TS và định dạng riêng", "Ảnh/video, telemetry, nhật ký, cấu hình và đôi khi cả tài liệu hướng dẫn cũ; không suy ra nội dung chỉ từ nhãn Raw."),
    "Reference Data": ("Nhiều định dạng", "Dữ liệu/tài liệu tham chiếu; ngữ nghĩa cụ thể tùy hồ sơ, không mặc định mọi tệp là thí nghiệm đối chứng."),
    "Calibration": ("TXT, ZIP, PDF, DOCX...", "Hiệu chuẩn; chỉ xuất hiện thành thư mục riêng ở FLEX/FLEX-2 trong snapshot. Hồ sơ khác có thể để hiệu chuẩn ở vị trí khác."),
    "Representative Image(s)": ("Ảnh và tệp minh họa", "Hình đại diện hỗ trợ xem nhanh, khác với toàn bộ chuỗi ảnh khoa học trong Raw Data."),
}

GROUPS = {
    "PSI-10": "ACME / Flame Design", "PSI-20": "ACME / BRE", "PSI-21": "ACME / CLD",
    "PSI-22": "ACME / E-FIELD", "PSI-23": "ACME / s-Flame", "PSI-159": "ACME / CFI-G",
    "PSI-25": "BASS-II", "PSI-26": "BASS", "PSI-39": "CFI", "PSI-47": "DAFT / DAFT-2",
    "PSI-60": "Phân tích dữ liệu SPICE", "PSI-62": "Mô hình đối chiếu BASS", "PSI-68": "FLEX-2", "PSI-69": "FLEX",
    "PSI-98": "SAFFIRE-I", "PSI-99": "SAFFIRE-II", "PSI-100": "SAFFIRE-III",
    "PSI-101": "SAME-R", "PSI-102": "SAME", "PSI-106": "SLICE", "PSI-107": "SPICE",
    "PSI-108": "STDCE-1, ngoài phạm vi cháy", "PSI-115": "Mô phỏng khói dùng SAME",
    "PSI-117": "Mô hình ngọn lửa lạnh dùng FLEX", "PSI-142": "Ngọn lửa lạnh / dữ liệu hình trong công bố",
    "PSI-181": "Hợp kim hàn, ngoài phạm vi cháy",
}

GRAIN = {
    "PSI-10": "Hàng có mã Test và điều kiện nhiên liệu/dòng/áp suất; tách normal và inverse flame.",
    "PSI-20": "Tổng hợp theo ngày; một dòng có thể bao gồm nhiều ngọn lửa và nhiều nồng độ O2. Ghi chú nói áp suất thay đổi nhưng không được liệt kê ở bảng tổng hợp.",
    "PSI-21": "Tổng hợp theo ngày/cấu hình nhiên liệu, có số ngọn lửa được đốt và dải pha loãng.",
    "PSI-22": "Tổng hợp ngày thử/cực tính điện trường, nhiên liệu và số ngọn lửa.",
    "PSI-23": "Tổng hợp ngày thử/khí quyển/nhiên liệu và số ngọn lửa.",
    "PSI-25": "Ma trận test có PI, mã test, mẫu, vật liệu, thông số hiển thị, khí ban đầu/cuối.",
    "PSI-26": "Bảng test vật liệu; đọc cùng ma trận as-run và hướng dẫn tổ chức.",
    "PSI-39": "Bảng tóm tắt điều kiện các phép thử giọt; đọc cùng workbook CFI và báo cáo từng run.",
    "PSI-47": "Hai mục tổng hợp điều kiện/mẫu; không phải danh sách mọi phép đếm hạt.",
    "PSI-68": "Tổng hợp theo loại nhiên liệu và dải điều kiện, không phải từng phép thử.",
    "PSI-69": "Bảng test có định danh FLEX, nhiên liệu, áp suất, thành phần khí, kích thước giọt và kết thúc test.",
    "PSI-98": "Thông số mẫu và camera, có cả điều kiện dòng và khí.",
    "PSI-99": "Mẫu thử, so sánh một số đặc trưng 1-g/vi trọng lực và mã camera; có ô chứa đơn vị và nhận xét định tính.",
    "PSI-100": "Thông số mẫu, kích thước, dòng khí và mã camera.",
    "PSI-101": "Các run khói với mã test, vật liệu, dòng, thời lượng và thời gian aging/mixing.",
    "PSI-102": "Tóm tắt mẫu/điều kiện sinh khói; không tương ứng một-một với mọi file run.",
    "PSI-106": "Danh sách ngày thử và nhiên liệu; không chứa đầy đủ biến đo của hơn 18 nghìn tệp.",
    "PSI-107": "Các điểm dữ liệu theo thời điểm, nhiên liệu, đường kính nozzle và lưu lượng.",
    "PSI-142": "Chỉ mục Data ID → mô tả dữ liệu → bài báo → số hình. Số đo nằm trong workbook Analyzed Data.",
    "PSI-159": "Bảng normal/inverse có các điều kiện dòng, thành phần, áp suất và trạng thái ngọn lửa.",
}


def size(value):
    value = float(value)
    for unit in ["B", "KiB", "MiB", "GiB", "TiB"]:
        if abs(value) < 1024 or unit == "TiB":
            return f"{value:,.2f} {unit}"
        value /= 1024


def main():
    inventory = json.loads((OUT / "inventory.json").read_text())
    samples = json.loads((OUT / "sample-inspection.json").read_text())["samples"]
    sample_manifest = json.loads((ROOT / "data/documents/psi-file-audit-2026-11-14/manifest.json").read_text())
    investigations = inventory["investigations"]
    scoped = [r for r in investigations if r["in_combustion_scope"]]
    files = [f for r in scoped for f in r["files"] if f["visible"] and f["status"] in [None, "active"]]
    all_files = [f for r in investigations for f in r["files"] if f["visible"] and f["status"] in [None, "active"]]
    total_bytes = sum(f["bytes"] for f in files)
    raw = [f for f in files if f["category"] == "Raw Data"]
    statistics = {
        "date": "2026-11-14", "investigations_searched": len(investigations), "combustion_investigations": len(scoped),
        "all_unique_file_assets": len(all_files), "combustion_unique_file_assets": len(files),
        "all_source_file_references": sum(r["source_file_references"] for r in investigations),
        "combustion_source_file_references": sum(r["source_file_references"] for r in scoped),
        "all_bytes_unique_listing": sum(f["bytes"] for f in all_files), "combustion_bytes_unique_listing": total_bytes,
        "raw_data_file_assets": len(raw), "raw_data_byte_share": sum(f["bytes"] for f in raw) / total_bytes,
        "small_files_inspected": len(samples), "small_files_downloaded_bytes": sample_manifest["total_bytes"],
        "restricted_file_assets_in_listing": sum(f["restricted"] for f in all_files),
    }
    categories = []
    for category, (formats, role) in CATEGORY_NOTES.items():
        selected = [f for f in files if f["category"] == category]
        categories.append({"category": category, "investigation_coverage": sum(category in r["categories"] for r in scoped),
                           "file_assets": len(selected), "bytes": sum(f["bytes"] for f in selected), "formats": formats, "role": role})
    compact = {"manifest": inventory["manifest"], "statistics": statistics, "categories": categories,
               "investigations": [{k: v for k, v in r.items() if k not in ["files", "folders", "experimental_tables", "modeling_tables"]} for r in investigations]}
    (OUT / "summary.json").write_text(json.dumps(compact, ensure_ascii=False, indent=2))
    with gzip.open(OUT / "file-assets.ndjson.gz", "wt", encoding="utf-8") as stream:
        for file in all_files:
            stream.write(json.dumps(file, ensure_ascii=False) + "\n")

    report = ["# Khảo sát Data files and documents của NASA PSI: combustion", "",
        "Ngày khảo sát: **14/11/2026** (Asia/Ho_Chi_Minh). Thời điểm bắt đầu snapshot: " + inventory["manifest"]["retrieved_at_utc"] + ".", "",
        "Nguồn: [kết quả tìm kiếm NASA PSI](" + inventory["manifest"]["search_url"] + ").", "",
        "## Phạm vi và cách khảo sát", "",
        f"Đã lấy danh mục tệp của **{len(investigations)} investigation**, gồm **{len(scoped)} hồ sơ Combustion Science** và hai hồ sơ trả về do khớp từ khóa ở lĩnh vực khác (PSI-108, PSI-181). "
        f"Đã đọc cấu trúc/nội dung mẫu của **{len(samples)} tệp nhỏ**, tổng dung lượng {size(sample_manifest['total_bytes'])}. "
        "Mẫu gồm toàn bộ CSV Experimental table của 20 hồ sơ về cháy có bảng này, các README/DoD, PDF hướng dẫn, workbook phân tích và ba ZIP metadata.", "",
        f"Trong toàn bộ kết quả có **{len(all_files):,} tài sản tệp phân biệt**; riêng 24 hồ sơ về cháy có **{len(files):,} tài sản tệp**, tổng kích thước danh mục **{size(total_bytes)}**. "
        "Đơn vị đếm là (investigation ID, file ID, file version); chưa bung các ZIP dữ liệu thô nên số ảnh/tệp bên trong archive không được tính thêm.", "",
        "- API danh sách tệp là endpoint chỉ truy vấn mà giao diện web sử dụng; mỗi truy vấn gắn với version hiện hành của investigation.",
        "- Metadata và cây tệp gốc được lưu theo snapshot, kèm SHA-256. Đã kiểm tra lại hash khi tái tổng hợp ngoại tuyến.",
        "- Không tải toàn bộ dữ liệu khoa học, ảnh hoặc video. CSV được đọc toàn bộ để khảo sát cấu trúc; workbook được xem cấu trúc sheet và tối đa 50 dòng đầu/sheet. Kích thước sheet khai báo không mặc định là số dòng dữ liệu thực.",
        "- PDF mẫu được trích văn bản theo trang; đã kiểm tra hình ảnh trang giới thiệu cách đọc BRE và trang tổ chức mô phỏng PSI-115.",
        "- Đây là khảo sát cấu trúc và khả năng sử dụng dữ liệu, không phải tái phân tích các kết quả vật lý của mọi phép thử.", "",
        "## Cấu trúc chung", "",
        "Mục này kết hợp metadata, bảng chỉ mục, tài liệu giải thích, dữ liệu đo, kết quả xử lý/mô phỏng và ảnh/video. Không có một cây thư mục bắt buộc giống nhau cho mọi investigation.", "",
        "| Nhóm tệp | Hồ sơ có nhóm / 24 | Tài sản tệp | Định dạng và vai trò |", "|---|---:|---:|---|"]
    for cat in categories:
        report.append(f"| {cat['category']} | {cat['investigation_coverage']} | {cat['file_assets']:,} | {cat['formats']}. {cat['role']} |")
    report += ["", f"**Raw Data chiếm {len(raw)/len(files):.2%} số tài sản và {statistics['raw_data_byte_share']:.2%} dung lượng** của 24 hồ sơ về cháy. "
               "Đây là lý do nên lập chỉ mục và đọc tài liệu mô tả trước khi quyết định tải archive lớn.", "",
        "### Cây hiển thị và nơi lưu tệp là hai thông tin khác nhau", "",
        "Ví dụ PSI-117 hiển thị một CSV trong Analyzed Data → Reduced Gravity → Simulation → PROC1, nhưng storage key nằm trực tiếp dưới psi-data/PSI-117/Analyzed Data và tên tệp có tiền tố PROCI. "
        "Danh mục cần giữ cả đường dẫn hiển thị, category/subcategory và storage key; không tự tạo URL tải bằng cách nối các nhãn thư mục.", "",
        "Các cách chia nhỏ gặp trong snapshot:", "",
        "- ACME/BRE: theo trọng lực và test point; một test có sensor CSV, cấu hình, setpoint, logs và ảnh/video.",
        "- BASS-II: theo nhóm PI rồi mã test như B1/M1, kèm mã sample và ngày GMT.",
        "- FLEX/FLEX-2: theo nhiên liệu, chiến dịch/cấu hình, mã test; có dữ liệu camera, radiometer, droplet và hiệu chuẩn.",
        "- SAFFIRE: theo mẫu và camera; có nhóm pre-flow/post-flow và các phiên bản ảnh nguyên gốc/đã xử lý.",
        "- SAME/SAME-R: theo vật liệu và Run; có log, dữ liệu cảm biến, bảng phân bố kích thước và kết quả xử lý.",
        "- SPICE/SLICE: theo ngày GMT/test, dữ liệu ảnh và thư mục Legacy; định dạng và tài liệu cũ có thể nằm trong Raw Data.",
        "- Các nghiên cứu mô hình: theo case/trọng lực hoặc theo bộ dữ liệu của hình trong công bố.", "",
        "## Tổng hợp từng investigation", "",
        "Số tệp dưới đây đã loại các tham chiếu lặp cùng ID và version. Dung lượng là kích thước đối tượng ở danh mục, chưa giải nén.", "",
        "| Hồ sơ | Nhóm/nội dung | Version | Tệp | Dung lượng | Các nhóm tệp hiện có |", "|---|---|---:|---:|---:|---|"]
    for r in investigations:
        report.append(f"| [{r['investigation_id']}]({r['source_url']}) | {GROUPS[r['investigation_id']]} | {r['version']} | {r['visible_files']:,} | {size(r['visible_bytes'])} | {', '.join(r['categories'])} |")
    report += ["", "### Những khác biệt đáng chú ý", "",
        "- **ACME:** cùng nhóm thiết bị không đồng nghĩa cùng sơ đồ dữ liệu. Flame Design/CFI-G có bảng chi tiết theo test, trong khi BRE/CLD/E-FIELD/s-Flame có bảng tổng hợp theo ngày hoặc nhóm thử. Dữ liệu cảm biến chi tiết nằm trong Raw Data.",
        "- **FLEX:** bộ FLEX có bảng test tương đối giàu biến; FLEX-2 có bảng chỉ tóm tắt dải điều kiện theo nhiên liệu. Không gộp hai bảng với giả định mỗi dòng đều là một test.",
        "- **BASS:** dùng ma trận mẫu/test. Workbook BASS có cả các sheet ghi dữ liệu không ghép được test point và test point chưa có dữ liệu; cần giữ quan hệ sample–test–file thay vì suy ra một-một.",
        "- **SAFFIRE:** có nhiều ZIP chứa các chuỗi ảnh khác nhau cho cùng camera/mẫu. Các biến thể mapped, TIFF, JPEG... là các sản phẩm khác nhau, không mặc định là các phép thử độc lập.",
        "- **SAME:** PSI-102 hiện không có thư mục Raw Data ở cấp gốc, nhưng có nhiều bảng Analyzed Data. Đây là khác biệt cách tổ chức; không chứng minh không tồn tại dữ liệu đo gốc ở nơi khác.",
        "- **SLICE:** có 18,707 tài sản tệp phân biệt, chủ yếu DAT trong Legacy/Raw Data. Các tài liệu kỹ thuật và DoD cũng nằm ở Raw Data; bộ trích nội dung không nên chỉ quét Science Documents.",
        "- **PSI-60 và PSI-62:** danh mục hiện hành chỉ có ZIP metadata; ba ZIP metadata mẫu được kiểm tra đều chứa hai tệp TXT mô tả hồ sơ. Không thấy tệp khoa học bổ sung trong hai danh mục này tại thời điểm khảo sát.",
        "- **PSI-115:** có 44 DAT Analyzed Data, báo cáo và tài liệu tổ chức dữ liệu. Case được chia theo trọng lực và điều kiện mô phỏng; tài liệu còn mô tả các biến thể bỏ cơ chế lắng, bỏ thermophoresis hoặc đổi hình học.",
        "- **PSI-142:** một workbook chứa sheet tổng hợp và tám sheet Data ID; các CSV chỉ mục liên kết mỗi Data ID với bài báo và số hình. Một tệp Excel có thể chứa nhiều bộ dữ liệu độc lập.", "",
        "## Experimental table không có cùng độ chi tiết", "",
        "Đã tải và đọc cả **22 CSV Experimental table thuộc 20 hồ sơ Combustion Science**. Cột số dòng là dòng không rỗng sau header, không mặc định là số phép thử độc lập.", "",
        "| Hồ sơ | Tệp | Dòng sau header | Độ chi tiết/cách đọc |", "|---|---|---:|---|"]
    for sample in samples:
        if sample["kind"] == "csv" and sample["category"] == "Experimental table":
            report.append(f"| [{sample['investigation_id']}](https://psi.nasa.gov/physci/repo/data/investigations/{sample['investigation_id']}) | {sample['name']} | {sample['nonempty_rows_including_header']-1} | {GRAIN[sample['investigation_id']]} |")
    report += ["", "## Đọc sâu ví dụ PSI-117", "",
        "Danh mục phiên bản 2 có **16 tệp**, khoảng **67.54 MiB**:", "",
        "- 1 ZIP metadata.", "- 4 PDF Presentations.", "- 10 tệp Analyzed Data: 1 README XLSX và 9 CSV.", "- 1 PDF luận án trong Reports.", "",
        "README XLSX cung cấp các điều kiện như nhiên liệu, đường kính ban đầu, áp suất/thành phần khí và liên kết tên bộ dữ liệu với **DOI + số hình**. "
        "Có bốn DOI khác nhau trong README; hai DOI không nằm trong danh sách Publications của metadata PSI-117 hiện hành: "
        "[10.1016/j.proci.2018.09.015](https://doi.org/10.1016/j.proci.2018.09.015) và "
        "[10.1007/s12217-024-10115-x](https://doi.org/10.1007/s12217-024-10115-x). "
        "Vì vậy một pipeline kho tri thức nên tìm liên kết tài liệu cả trong README/bảng dữ liệu, đồng thời giữ rõ quan hệ tham chiếu từ tệp.", "",
        "Các CSV không phải mọi dòng đều là một observation với cùng schema. Có tệp đặt nhiều cặp trục x/y cạnh nhau, ngăn bằng cột trống; có block EXPT/EXP và Simulations/Model cùng nằm trong một bảng. "
        "Không nên gán toàn bộ CSV là dữ liệu mô phỏng chỉ vì nằm trong thư mục Simulation. Phải tách từng series và đối chiếu hình tương ứng trước khi nhập Measurement.", "",
        "README cũng có trường thành phần khí biểu diễn không nhất quán ở vài ô (ví dụ XO2 là 0.21 nhưng XN2 là 74 ở cùng dòng). "
        "Khảo sát giữ nguyên nguồn, chưa sửa hay tự suy đoán đơn vị; cần đối chiếu công bố trước khi chuẩn hóa thành mole fraction.", "",
        "## Chất lượng dữ liệu và các điểm cần kiểm tra", "",
        f"1. **Tham chiếu lặp:** cây trả về {statistics['all_source_file_references']:,} lượt tham chiếu cho toàn bộ 26 hồ sơ, tương ứng {len(all_files):,} ID/version phân biệt. "
        "Các lần lặp được kiểm tra có cùng storage key và byte size; danh mục chuẩn hóa giữ reference_count và các display path.",
        "2. **Dung lượng tổng:** ở vài hồ sơ, tổng kích thước metadata không khớp tổng cây tệp kể cả trước khử lặp. Report giữ riêng metadata_total_bytes, source_reference_bytes và visible_bytes; không đồng nhất ba đại lượng này.",
        "3. **Tên thư mục không xác định trọn ngữ nghĩa:** Raw Data có thể chứa dữ liệu đã chuyển đổi, tài liệu và dữ liệu mặt đất Legacy; Analyzed Data có thể là PDF hoặc định dạng phần mềm chuyên dụng, không chỉ CSV sạch.",
        "4. **Đơn vị và giá trị:** nguồn có chuỗi số kèm đơn vị, dải, dấu xấp xỉ, n/a, nhận xét và nhiều giá trị trong một ô. Cần giữ raw_value, unit và quy tắc chuyển đổi; không biến thiếu dữ liệu thành 0.",
        "5. **Thời gian và hiệu chuẩn:** README BASS-II nêu sai lệch giữa ngày hiển thị video và ngày thực; đồng thời giải thích các kênh hiển thị và hiệu chỉnh O2. Tài liệu ACME nêu dữ liệu sensor có thể cần chuyển đổi từ tín hiệu thô sang đơn vị kỹ thuật.",
        "6. **Tình trạng phép thử:** README riêng cho một test FLEX nêu lỗi camera và ảnh chỉ còn đến gần thời điểm đánh lửa. Các ghi chú kiểu này phải được đưa vào quality flag trước khi dùng cho mô hình.",
        "7. **Phiên bản:** lưu cả version của investigation và version của từng file. Link tải S3 có chữ ký chỉ là link tạm; dùng ID, version và endpoint NASA để truy xuất lại.",
        "8. **Định dạng riêng/lỗi đặt tên:** có MDIPSUG, PXP, DAT và tên phần mở rộng như ziip hoặc log có khoảng trắng. Không tự nhận diện mọi ZIP là ảnh hoặc mọi TXT/DAT là văn bản tri thức.", "",
        "## Cách đưa phần này vào hệ thống", "",
        "### Những thực thể cần bổ sung", "",
        "`Investigation → DataAsset → ExperimentalRun/Series → Measurement`", "",
        "`DataAsset → references Publication/Figure` và `DataAsset → EvidenceChunk` cho phần tài liệu.", "",
        "DataAsset cần giữ: file ID, study/file version, category, subcategory, display path, storage key, định dạng, byte size, nguồn và hash khi đã tải. "
        "Bổ sung asset_role, data_origin (experiment/simulation/derived/unknown), processing_level và quality flags sau khi đọc tài liệu; không suy ra toàn bộ từ một nhãn thư mục.", "",
        "### Thứ tự nhập phù hợp", "",
        "1. Danh mục tệp + ZIP metadata + Experimental table để biết có gì và ở đâu.",
        "2. README/DoD/Science Documents/Reports cần thiết để hiểu cách đọc, thiết bị, hiệu chuẩn và liên kết tới công bố.",
        "3. Analyzed Data có schema đã được đối chiếu, tách theo test/series/figure; đưa số đo vào kho có cấu trúc.",
        "4. Raw sensor data hoặc một archive ảnh/video được chọn cho câu hỏi cụ thể; giữ tham chiếu tới phần còn lại.", "",
        "Kho tri thức văn bản ưu tiên tài liệu giải thích và nội dung công bố. Dữ liệu số cần bộ đọc và kiểm tra đơn vị riêng. "
        "Với ảnh/video/ZIP lớn, trước hết chỉ lập chỉ mục và giữ link; các đặc trưng/đại lượng trích xuất phải có phương pháp và nguồn rõ ràng.", "",
        "## Nguồn tệp mẫu đã kiểm tra", "",
        "Các link dưới đây dùng endpoint NASA với ID và version của snapshot; dịch vụ có thể trả về URL tải có thời hạn. Tệp gốc đã tải được lưu local cùng SHA-256 trong manifest mẫu.", "",
        "| Hồ sơ | Tệp mẫu | Nhóm |", "|---|---|---|"]
    for sample in samples:
        report.append(f"| {sample['investigation_id']} | [{sample['name']}]({sample['download_endpoint']}) | {sample['category']} |")
    report += ["", "## Tệp kết quả", "",
        "- `outputs/psi-file-audit-2026-11-14/summary.json`: thống kê và tóm tắt từng investigation.",
        "- `outputs/psi-file-audit-2026-11-14/file-assets.ndjson.gz`: toàn bộ tài sản tệp cấp danh mục, dạng NDJSON nén để nhập lại.",
        "- `outputs/psi-file-audit-2026-11-14/inventory.json`: danh mục chi tiết cùng cấu trúc thư mục và provenance.",
        "- `data/raw/file-audit-*/`: metadata và phản hồi cây tệp gốc của đủ 26 hồ sơ.",
        "- `data/documents/psi-file-audit-2026-11-14/manifest.json`: danh sách 62 tệp mẫu đã tải, nguồn và hash.", "",
        "Chạy lại thống kê từ snapshot không cần mạng bằng `pipelines/audit_psi_files.py --snapshot <path>`. "
        "Các script đọc mẫu cần `pypdf` và `openpyxl`; lần khảo sát này dùng bộ thư viện có sẵn của môi trường Codex.", ""]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(report))
    print(json.dumps(statistics, ensure_ascii=False, indent=2))
    print("REPORT", REPORT)
    print("SUMMARY", OUT / "summary.json")


if __name__ == "__main__":
    main()
