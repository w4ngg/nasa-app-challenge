import csv
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "knowledge" / "fire-risk"
OUTPUT = ROOT / "apps" / "web" / "public" / "data" / "fire-risk.json"


def read_json(path):
    with path.open(encoding="utf-8-sig") as stream:
        return json.load(stream)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def number(value):
    """Chỉ chuyển số thuần; không lấy số từ ghi chú."""
    if value is None or isinstance(value, bool):
        return None

    try:
        result = float(value)
    except (TypeError, ValueError):
        return None

    return result if math.isfinite(result) else None


def numeric_fields(rows, columns):
    result = []

    for original in rows:
        row = dict(original)

        for column in columns:
            if column not in row:
                raise ValueError(f"Thiếu cột bắt buộc: {column}")
            row[column] = number(row[column])

        result.append(row)

    return result


def require_unique(rows, field):
    values = [row.get(field) for row in rows]

    if any(value is None or str(value).strip() == "" for value in values):
        raise ValueError(f"Thiếu giá trị khóa {field}")

    if len(values) != len(set(values)):
        raise ValueError(f"Khóa bị trùng: {field}")


def file_reference(path):
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    paths = {
        "samer_manifest": SOURCE / "samer" / "manifest.json",
        "samer_working": SOURCE / "samer" / "samer_working.csv",
        "samer_insights": SOURCE / "samer" / "insights.json",
        "samer_sts": SOURCE / "samer" / "sts_chart_15.csv",
        "samer_sts_all": SOURCE / "samer" / "sts_all_17_with_chart_status.csv",
        "samer_kapton": SOURCE / "samer" / "kapton_exploratory_subset.csv",
        "bass2_manifest": SOURCE / "bass2" / "manifest.json",
        "bass2_working": SOURCE / "bass2" / "bass2_working.json",
        "bass2_insights": SOURCE / "bass2" / "insights.json",
        "bass2_observations": SOURCE / "bass2" / "bass2_report_observations.json",
    }

    for path in paths.values():
        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy: {path}")

    samer_manifest = read_json(paths["samer_manifest"])
    bass2_manifest = read_json(paths["bass2_manifest"])

    samer_runs = numeric_fields(
        read_csv(paths["samer_working"]),
        [
            "velocity_cm_s",
            "rt_r0",
            "net_aging_s",
            "amd_um",
            "mass_mean_diameter_um",
            "source_excel_row",
        ],
    )

    sts_points = numeric_fields(
        read_csv(paths["samer_sts"]),
        [
            "amd_um",
            "sts_delta_calculated_v",
            "velocity_cm_s",
            "rt_r0",
            "net_aging_s",
            "source_excel_row",
        ],
    )

    kapton_points = numeric_fields(
        read_csv(paths["samer_kapton"]),
        [
            "velocity_cm_s",
            "rt_r0",
            "net_aging_s",
            "amd_um",
            "source_excel_row",
        ],
    )

    bass2_runs = read_json(paths["bass2_working"])
    observations = read_json(paths["bass2_observations"])

    require_unique(samer_runs, "record_id")
    require_unique(bass2_runs, "record_id")

    if len(samer_runs) != samer_manifest["working_records"]:
        raise ValueError("Số bản ghi SAME-R khác manifest.")

    if len(bass2_runs) != bass2_manifest["record_count"]:
        raise ValueError("Số bản ghi BASS-II khác manifest.")

    if len(sts_points) != samer_manifest["sts_chart_records"]:
        raise ValueError("Số điểm STS khác manifest.")

    if len(kapton_points) != samer_manifest["kapton_subset_records"]:
        raise ValueError("Số điểm Kapton khác manifest.")

    samer_source_rows = {
        row["source_excel_row"] for row in samer_runs
    }

    for row in sts_points + kapton_points:
        if row["source_excel_row"] not in samer_source_rows:
            raise ValueError("Điểm biểu đồ không có bản ghi nguồn SAME-R.")

    for row in sts_points:
        if row["amd_um"] is None or row["amd_um"] <= 0:
            raise ValueError("Điểm STS thiếu AMD dương.")

        if row["sts_delta_calculated_v"] is None:
            raise ValueError("Điểm STS thiếu delta.")

        same_id = str(row.get("same_id", "")).strip().lower()
        if row.get("material") == "Teflon" and same_id in {"111", "111.0"}:
            raise ValueError("Teflon–111 chưa được phép vào biểu đồ STS.")

    for row in bass2_runs:
        if row["delta_o2_status"] != "available_descriptive":
            if row["delta_o2_percentage_points"] is not None:
                raise ValueError(
                    f"ΔO₂ cần để null: {row['record_id']}"
                )

    bass2_keys = {
        (row["pi"], row["test_id"]) for row in bass2_runs
    }

    for observation in observations:
        if (observation["pi"], observation["test_id"]) not in bass2_keys:
            raise ValueError("Quan sát BASS-II không nối được với test.")

    # Chuyển insight về cùng schema, giữ nội dung nguồn trong payload.
    findings = []

    for study_id, source_name in [
        ("PSI-101", "samer_insights"),
        ("PSI-25", "bass2_insights"),
    ]:
        for item in read_json(paths[source_name]):
            local_id = item.get("insight_id") or item.get("id")

            if not local_id:
                raise ValueError(f"Insight thiếu ID: {source_name}")

            findings.append({
                "id": f"finding:{study_id}:{local_id}",
                "investigation_id": study_id,
                "title": item["title"],
                "statement": item["statement"],
                "status": item["status"],
                "limitations": item.get("limitations", []),
                "source_payload": item,
            })

    require_unique(findings, "id")

    result = {
        "schema_version": "1.0",
        "status": "provisional",
        "scope": "SAME-R and BASS-II reviewed subsets",
        "studies": [
            {
                "id": "PSI-101",
                "name": "SAME-R",
                "fuel_phase": "solid",
                "gravity_regime": "microgravity",
                "topics": [
                    "smoke_detection",
                    "smoke_particle_characteristics",
                ],
                "record_count": len(samer_runs),
            },
            {
                "id": "PSI-25",
                "name": "BASS-II",
                "fuel_phase": "solid",
                "gravity_regime": "microgravity",
                "topics": [
                    "flame_spread",
                    "extinction",
                    "atmosphere_conditions",
                ],
                "record_count": len(bass2_runs),
            },
        ],
        "findings": findings,
        "samer": {
            "runs": samer_runs,
            "sts_points": sts_points,
            "sts_all_records": read_csv(paths["samer_sts_all"]),
            "kapton_points": kapton_points,
            "source_manifest": samer_manifest,
        },
        "bass2": {
            "runs": bass2_runs,
            "observations": observations,
            "source_manifest": bass2_manifest,
        },
        "source_files": [
            file_reference(path) for path in paths.values()
        ],
        "limitations": [
            "Record counts are not independent experiment counts.",
            "Research relevance is not fire probability.",
            "Microgravity results are not validated for partial gravity.",
            "STS delta is not an established detection threshold.",
            "Original NASA source URLs still require integration.",
        ],
    }

    # allow_nan=False bảo đảm JSON không chứa NaN/Infinity.
    encoded = json.dumps(
        result,
        ensure_ascii=False,
        indent=2,
        allow_nan=False,
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(encoded + "\n", encoding="utf-8")

    print("ĐÃ TẠO:", OUTPUT.relative_to(ROOT).as_posix())
    print("SAME-R:", len(samer_runs), "bản ghi")
    print("BASS-II:", len(bass2_runs), "bản ghi")
    print("STS:", len(sts_points), "điểm")
    print("Kapton:", len(kapton_points), "điểm")
    print("Findings:", len(findings))
    print("Không sửa dữ liệu nguồn.")


if __name__ == "__main__":
    main()