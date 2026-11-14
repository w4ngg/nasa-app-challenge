"""Read the audit samples without editing them. Requires pypdf and openpyxl."""
import argparse
import csv
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from openpyxl import load_workbook
from pypdf import PdfReader


def inspect(file):
    path = Path(file["local_path"])
    result = {k: file[k] for k in ["investigation_id", "name", "category", "subcategory", "file_id", "file_version", "investigation_version", "download_endpoint", "local_path"]}
    extension = file["extension"]
    if extension == ".csv":
        text = path.read_bytes().decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
        nonempty = [row for row in rows if any(value.strip() for value in row)]
        result.update({"kind": "csv", "rows_including_header": len(rows),
                       "nonempty_rows_including_header": len(nonempty),
                       "row_widths": sorted({len(row) for row in rows}),
                       "first_rows": rows[:6], "last_rows": rows[-3:]})
    elif extension == ".xlsx":
        workbook = load_workbook(path, read_only=True, data_only=False)
        sheets = []
        for sheet in workbook:
            rows = []
            for index, row in enumerate(sheet.iter_rows(min_row=1, max_row=min(sheet.max_row or 1, 50), max_col=min(sheet.max_column or 1, 50), values_only=True), 1):
                if any(value is not None for value in row):
                    rows.append({"row_number": index, "values": list(row)})
            sheets.append({"name": sheet.title, "declared_rows": sheet.max_row,
                           "declared_columns": sheet.max_column, "first_nonempty_rows": rows[:18]})
        workbook.close()
        result.update({"kind": "xlsx", "sheets": sheets})
    elif extension == ".pdf":
        reader = PdfReader(path)
        pages = [{"page_number": index, "text": page.extract_text() or ""} for index, page in enumerate(reader.pages, 1)]
        result.update({"kind": "pdf", "page_count": len(pages), "pages": pages})
    elif extension == ".docx":
        with zipfile.ZipFile(path) as archive:
            document = ET.fromstring(archive.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = ["".join(node.text or "" for node in paragraph.findall(".//w:t", ns)) for paragraph in document.findall(".//w:p", ns)]
        result.update({"kind": "docx", "paragraphs": paragraphs})
    elif extension == ".zip":
        with zipfile.ZipFile(path) as archive:
            members = archive.namelist()
            fields = {}
            for name in members:
                if re.search(r"(?:^|/)i_[^/]+\.txt$", name):
                    text = archive.read(name).decode("utf-8-sig", errors="replace")
                    fields[name] = [line.split("\t", 1)[0] for line in text.splitlines()]
        result.update({"kind": "metadata_zip", "members": members, "investigation_field_names": fields})
    else:
        result.update({"kind": "text", "text": path.read_bytes().decode("utf-8-sig", errors="replace")})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    results = []
    for file in manifest["files"]:
        result = inspect(file)
        results.append(result)
        print(file["investigation_id"], result["kind"], file["name"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"sample_count": len(results), "samples": results}, ensure_ascii=False, indent=2, default=str))
    print("EXTRACTION", args.output)


if __name__ == "__main__":
    main()
