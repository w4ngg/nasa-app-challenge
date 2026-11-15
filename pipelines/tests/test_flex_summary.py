"""Scientific identity and missing-data invariants for the FLEX adapter."""
import importlib.util
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("summarize_flex", Path(__file__).resolve().parents[1] / "summarize_flex.py")
flex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flex)


def row(number, cir, d0):
    return {"FLEX Test #": str(number), "FLEX Identifier": cir, "Droplet initial diameter; mm": str(d0)}


def sheet(number, cir, d0, folder="", title=None):
    return {"test_id": str(number), "role": "TestSheet", "display_path": folder,
            "text": f"FLEX-{title or number}\nCIR Test Number: {cir}\nD0 (mm) = {d0}\nCOMMENTS:\nSource observations."}


class FlexSourceTests(unittest.TestCase):
    def test_file_number_is_not_assumed_equal_to_catalog_number(self):
        result = flex.map_sources([row(157, "C05M101", 4.24)], [sheet(158, "C05M101", 4.24)], lambda item: item["text"])
        self.assertEqual(result["157"]["source_test_id"], "158")

    def test_mistyped_folder_does_not_override_matching_test_sheet(self):
        rows = [row(11, "256R001", 4), row(13, "256R002", 3)]
        files = [sheet(11, "256R001", 4), sheet(13, "256R002", 3, "MeOH/FLEX_013_256R001/")]
        result = flex.map_sources(rows, files, lambda item: item["text"])
        self.assertEqual(result["13"]["source_test_id"], "13")
        self.assertEqual(result["11"]["source_test_id"], "11")
        self.assertTrue(result["13"]["warnings"])

    def test_copied_sheet_does_not_attach_another_tests_interpretation(self):
        rows = [row(127, "C13M301", 3.22), row(128, "C13M401", 2.91)]
        files = [sheet(127, "C13M301", 3.22), sheet(128, "C13M301", 3.22, "MeOH/FLEX_128_C13M401/", title=127)]
        result = flex.map_sources(rows, files, lambda item: item["text"])
        self.assertEqual(result["128"]["source_test_id"], "128")
        self.assertEqual(result["128"]["cir"], "C13M401")
        self.assertNotEqual(result["128"]["sheet_cir"], result["128"]["cir"])

    def test_duplicate_cir_needs_additional_identity_evidence(self):
        rows = [row(70, "193F001", 4.67), row(73, "193F001", 4.64), row(74, "193F001", "")]
        files = [sheet(70, "193F001", 4.67), sheet(73, "193F001", 4.64)]
        result = flex.map_sources(rows, files, lambda item: item["text"])
        self.assertEqual(result["70"]["source_test_id"], "70")
        self.assertEqual(result["73"]["source_test_id"], "73")
        self.assertIsNone(result["74"])

    def test_invalid_series_values_are_gaps_and_bad_headers_are_reported(self):
        text = "DropletTime_sec\tDropletDiameter_mm\n0\t2\n.03\tinf\n.06\t1.8\nnan\t1.7\n"
        result = flex.read_series(text, "DropletData")
        self.assertEqual(result["points"], [[0, 2], [.03, None], [.06, 1.8]])
        self.assertEqual(result["invalid_count"], 2)
        self.assertTrue(flex.read_series("time\tdiameter\n0\t2", "DropletData")["error"])
        for value in ("nan", "inf", "~6", "1–3", ""):
            self.assertIsNone(flex.scalar(value))

    def test_d_squared_fit_reports_its_interval_and_sample_count(self):
        points = [[t/10, math.sqrt(10-.5*t/10)] for t in range(20)]
        fit = flex.fit_interval(points, 0, 1.9)
        self.assertAlmostEqual(fit["k_mm2_s"], .5)
        self.assertEqual(fit["points"], 20)
        self.assertEqual(fit["window_s"], [0, 1.9])


if __name__ == "__main__":
    unittest.main()
