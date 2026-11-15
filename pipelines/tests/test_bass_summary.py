"""Identity, missing data and reproducibility of the text-only PSI-25 adapter."""
import copy
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("summarize_bass", ROOT / "pipelines/summarize_bass.py")
bass = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bass)
TABLE = json.loads((ROOT / "apps/web/public/data/tables/PSI-25.json").read_text())[0]
REVIEWED = json.loads((ROOT / "data/reference/psi25-reviewed-results.json").read_text())


class BassSummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = bass.build(TABLE, REVIEWED)

    def test_every_catalog_record_retains_its_identity_and_original_cells(self):
        self.assertEqual(self.data["coverage"], {"tests": 129, "reported_results": 20, "with_spread_rates": 18, "with_notes": 1, "catalog_only": 109})
        for row, entry in zip(TABLE["rows"], self.data["tests"], strict=True):
            self.assertEqual(entry["catalog_row"], row)
            self.assertEqual(entry["test_id"], row[1])
            self.assertIsNone(entry["time_series"])

    def test_published_asset_reproduces_exactly_from_catalog_and_reviewed_facts(self):
        actual = json.loads((ROOT / "apps/web/public/data/bass-ii/summaries.json").read_text())
        expected = {**self.data, "reviewed_source_sha256": hashlib.sha256((ROOT / "data/reference/psi25-reviewed-results.json").read_bytes()).hexdigest()}
        self.assertEqual(actual, expected)

    def test_m8_report_values_and_decimal_derived_metrics_are_distinct(self):
        entry = next(t for t in self.data["tests"] if t["test_id"] == "M8")
        self.assertEqual((entry["pi"], entry["sample_id"], entry["date"]), ("Miller", "178m", "7/11/2014"))
        result = entry["reported_result"]
        self.assertEqual(result["flow_spread_pairs"], [{"airflow_cm_s": 10, "spread_rate_mm_s": .057}, {"airflow_cm_s": 6, "spread_rate_mm_s": .056}, {"airflow_cm_s": 5, "spread_rate_mm_s": .04}])
        derived = {m["key"]: m["value"] for m in entry["derived_metrics"]}
        self.assertEqual(derived["delta_o2"], -.9)
        self.assertEqual(derived["delta_co2"], .84)
        self.assertEqual(derived["delta_co"], 415)
        self.assertEqual(derived["burn_time_s"], 1512)
        self.assertAlmostEqual(derived["spread_change_5_vs_10"], -29.8245614035)
        self.assertTrue(entry["source_conflicts"])
        self.assertIn("not an airflow measurement", entry["interpretation"])

    def test_not_tracked_and_catalog_only_have_no_fabricated_outcomes(self):
        for test_id in ["M6", "M12"]:
            result = next(t for t in self.data["tests"] if t["test_id"] == test_id)["reported_result"]
            self.assertEqual(result["spread_status"], "Not tracked")
            self.assertTrue(all(p["spread_rate_mm_s"] is None for p in result["flow_spread_pairs"]))
        for entry in self.data["tests"]:
            if entry["coverage"] == "catalog_only":
                self.assertIsNone(entry["reported_result"])
                self.assertIsNone(entry["researcher_notes"])
                self.assertEqual([s["key"] for s in entry["sources"]], ["catalog"])

    def test_qualified_missing_offset_and_nonfinite_readings_are_not_zero(self):
        for text in ["", "none", "OR", ">500", "10, 5", "~20", "-1", "inf", "1e999"]:
            self.assertIsNone(bass.gas_cell(text, None)["value"], text)
            self.assertIsNotNone(bass.gas_cell(text, None)["issue"], text)
        self.assertEqual(bass.gas_cell("0", 100)["value"], 0)
        self.assertIsNone(bass.gas_cell("101", 100)["value"])

    def test_report_joins_fail_closed_on_investigator_oxygen_and_note_identity(self):
        for column, replacement in [("PI", "Olson"), ("Calibrated initial O2 % by vol", "20"), ("Sample #", "other sample")]:
            table = copy.deepcopy(TABLE)
            row = next(r for r in table["rows"] if r[1] == "M8")
            row[table["columns"].index(column)] = replacement
            with self.assertRaises(ValueError):
                bass.build(table, REVIEWED)
        reviewed = copy.deepcopy(REVIEWED)
        reviewed["table_5_1"]["rows"][7][5] = [.057]
        with self.assertRaisesRegex(ValueError, "Unpaired"):
            bass.build(TABLE, reviewed)

    def test_changed_catalog_snapshot_requires_review_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            output = Path(directory) / "summaries.json"
            path.write_text(json.dumps([TABLE]))
            result = subprocess.run([sys.executable, str(ROOT / "pipelines/summarize_bass.py"), "--catalog", str(path), "--output", str(output)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Catalog export changed", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
