"""Download a bounded set of small public files for the PSI file-structure audit."""
import argparse
import concurrent.futures
import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


DOCUMENT_NAMES = {
    "PSI-20": ["ACME_non-imaging_data_file_description.pdf", "BRE_data_interpretation_20220804.pdf"],
    "PSI-22": ["E-FIELD Flames data interpretation document.pdf"],
    "PSI-25": ["BASS-II_ReadMe.docx", "BASS-II_Test.Matrices.xlsx"],
    "PSI-26": ["As Run_Test Matrix.xlsx"],
    "PSI-39": ["CFI_DataSummary_Spreadsheet_Jan2021.xlsx", "CFI Science Final Report.pdf", "FLEX-1261_Summary.pdf"],
    "PSI-47": ["DAFT_30Day.PostFlightReport.pdf"],
    "PSI-68": ["FLEX-2 DoD.docx"],
    "PSI-69": ["FLEX DoD.docx", "20CAL13_Readme.txt", "256R002_Readme.txt"],
    "PSI-98": ["SAFFIRE-I and SAFFIRE-III Readme.docx", "SAFFIRE-I Image Directory Nomenclature.pdf"],
    "PSI-99": ["SAFFIRE-II Readme.docx"],
    "PSI-101": ["54 lampwick binneddatacorr from GWM.xlsx"],
    "PSI-102": ["SAME_Operations Manual_007.pdf", "GMT267silicon test 23 and 24 log.xlsx"],
    "PSI-106": ["SLICE DoD.docx", "GMT2012_040_SLICE_num.txt"],
    "PSI-107": ["SPICE Image Organization Guide.docx", "SPICE_FinalReport.pdf"],
    "PSI-115": ["DataOrganizationDocument.pdf", "8cmGravityPSD.dat"],
    "PSI-142": ["PSI data summary Princeton with links.xlsx"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--destination", type=Path, default=Path("data/documents/psi-file-audit-2026-11-14"))
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text())
    candidates = []
    for investigation in inventory["investigations"]:
        if not investigation["in_combustion_scope"]:
            continue
        aid = investigation["investigation_id"]
        for file in investigation["files"]:
            if file["restricted"] or not file["visible"]:
                continue
            name = file["name"]
            select = file["category"] == "Experimental table" and file["extension"] == ".csv"
            select |= aid == "PSI-117" and file["category"] == "Analyzed Data"
            select |= aid in ["PSI-60", "PSI-62", "PSI-117"] and file["category"] == "Investigation Metadata Files"
            select |= any(name.endswith(suffix) for suffix in DOCUMENT_NAMES.get(aid, []))
            if select:
                if not 0 < file["bytes"] <= 2_000_000:
                    raise ValueError("Sample exceeds the small-file bound: " + name)
                candidates.append(file)
    args.destination.mkdir(parents=True, exist_ok=True)
    print("SELECTED", len(candidates), "FILES", int(sum(f["bytes"] for f in candidates)), "BYTES", flush=True)

    def download(file):
        aid = file["investigation_id"]
        path = args.destination / aid / (file["file_id"] + file["extension"])
        params = {"file": file["file_id"], "version": file["file_version"],
                  "studyVersion": file["investigation_version"], "redirect": "false"}
        source_url = f"https://psi.nasa.gov/geode-py/ws/studies/{aid}/download?" + urllib.parse.urlencode(params)
        if not path.exists():
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(source_url, timeout=45) as response:
                        signed_url = response.read().decode().strip().strip('"')
                    if not signed_url.startswith("https://"):
                        raise ValueError("NASA did not return a download URL")
                    with urllib.request.urlopen(signed_url, timeout=45) as response:
                        content = response.read(2_000_001)
                    if len(content) > 2_000_000 or len(content) != int(file["bytes"]):
                        raise ValueError("Downloaded size does not match inventory")
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)
        content = path.read_bytes()
        print(aid, file["name"], len(content), flush=True)
        return {**file, "local_path": str(path.resolve()), "download_endpoint": source_url,
                "sha256": hashlib.sha256(content).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        files = list(pool.map(download, candidates))
    manifest = {"source_snapshot": inventory["manifest"]["retrieved_at_utc"], "files": files,
                "sample_count": len(files), "total_bytes": sum(f["bytes"] for f in files)}
    (args.destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print("MANIFEST", args.destination / "manifest.json")


if __name__ == "__main__":
    main()
