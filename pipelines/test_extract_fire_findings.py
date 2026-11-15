"""Offline checks: py -m unittest discover -s pipelines -p 'test_extract_fire_findings.py' -v"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "fire_extractor", Path(__file__).with_name("extract_fire_findings.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)

QUOTE = "Test B1 showed extinction after the airflow was interrupted during the experiment."

def finding():
    return {"title": "Flow interruption", "statement": "Test B1 showed extinction.",
            "kind": "experimental_observation", "quote": QUOTE,
            "test_ids": ["B1"], "conditions": [], "limitations": [],
            "scope": "single_test", "missing_conditions": ["oxygen", "pressure"],
            "author_limitations": []}


class ValidationTests(unittest.TestCase):
    def test_grounded_finding(self):
        self.assertEqual(extractor.validate(finding(), QUOTE, {"B1"}), [])

    def test_fabricated_quote(self):
        self.assertIn("quote_not_in_segment",
                      extractor.validate(finding(), "Unrelated page", {"B1"}))

    def test_invented_number(self):
        item = finding()
        item["statement"] = "Extinction occurred at 0.35 cm/s."
        self.assertIn("unsupported_numeric_tokens", extractor.validate(item, QUOTE, {"B1"}))

    def test_unknown_test(self):
        self.assertIn("test_not_in_catalog:B1", extractor.validate(finding(), QUOTE, {"B2"}))

    def test_wrong_types(self):
        self.assertEqual(extractor.validate([], QUOTE, None), ["finding_not_object"])
        item = finding()
        item["conditions"] = "not a list"
        self.assertIn("invalid_conditions", extractor.validate(item, QUOTE, None))

    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            extractor.write_new(path, {"original": True})
            with self.assertRaises(FileExistsError):
                extractor.write_new(path, {"original": False})
            self.assertTrue(json.loads(path.read_text())["original"])

    def test_invented_title_number(self):
        item = finding()
        item["title"] = "Extinction in 9 seconds"
        self.assertIn("unsupported_numeric_tokens", extractor.validate(item, QUOTE, None))

    def test_caveat_needs_source(self):
        item = finding()
        item["author_limitations"] = [{"statement": "Calibration is uncertain.", "quote": "invented"}]
        self.assertIn("author_limitation_quote_not_in_segment", extractor.validate(item, QUOTE, None))

    def test_sourced_caveat(self):
        item = finding()
        caveat = "Calibration at low velocity has significant uncertainty."
        item["author_limitations"] = [{"statement": caveat, "quote": caveat}]
        self.assertEqual(extractor.validate(item, QUOTE + ' ' + caveat, None), [])

    def test_context_and_missing_caveats_flagged(self):
        item = finding()
        item["quote"] += " Under the same conditions."
        result = extractor.review_metadata(item, "There is a time lag.")
        self.assertIn("unresolved_context_reference", result["review_flags"])
        self.assertIn("segment_caveats_may_be_missing", result["review_flags"])
        self.assertFalse(result["approved_for_publication"])
        self.assertTrue(result["review_required"])

    def test_duplicate_sourced_legacy_caveat_allowed(self):
        item = finding()
        caveat = "There are significant uncertainties in calibration at low velocity."
        item["author_limitations"] = [{"statement": caveat, "quote": caveat}]
        item["limitations"] = ["significant uncertainties in calibration at low velocity"]
        self.assertEqual(extractor.validate(item, QUOTE + ' ' + caveat, None), [])

    def test_unsourced_legacy_caveat_rejected(self):
        item = finding()
        item["limitations"] = ["This proves safety on Mars."]
        self.assertIn("unsourced_legacy_limitation", extractor.validate(item, QUOTE, None))

    def test_subset_cannot_silently_claim_single_test(self):
        item = finding()
        item["quote"] = "Repeated experiments on samples established the reported extinction velocities."
        self.assertIn("single_test_scope_needs_confirmation", extractor.review_metadata(item, item["quote"])["review_flags"])

    def test_extraction_with_fake_client(self):
        # No network, no API key, no usage-file writes.
        module = ModuleType("assistant.llm")
        class FakeClient:
            model = "offline-test"
            last_usage = {}
            def chat(self, messages, *, max_tokens=None):
                assert max_tokens == 1800
                return SimpleNamespace(content=json.dumps({
                    "findings": [finding(), finding(), {**finding(), "quote": "x"}]
                })), 0.0
        module.DeepSeekClient = FakeClient
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            prepared = base / "prepared.json"
            extractor.write_new(prepared, {
                "version": extractor.VERSION, "source_sha256": "test-hash",
                "investigation_id": "PSI-25", "document_id": "test-document",
                "source_file": "test.pdf", "source_url": None,
                "segments": [{"id": "p1-c0", "pdf_page": 1, "text": QUOTE,
                              "text_sha256": extractor.digest(QUOTE.encode())}]
            })
            args = argparse.Namespace(input=prepared, out=base / "run", tests=None, max_calls=1, max_output_tokens=1800)
            with patch.dict(sys.modules, {"assistant.llm": module}):
                extractor.extract(args)
            result = json.loads((args.out / "results.json").read_text())
            self.assertEqual(len(result["candidates"]), 1)
            self.assertEqual(len(result["rejected"]), 1)
            self.assertEqual(result["failures"], [])
            self.assertEqual(result["candidates"][0]["status"], "candidate")
            self.assertFalse(result["candidates"][0]["scientifically_verified"])


if __name__ == "__main__":
    unittest.main()
