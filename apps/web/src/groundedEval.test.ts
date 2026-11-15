import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildEvidenceChunks, runGroundedPipelineSync } from "./lib/groundedPipeline.ts";
import { clampNumeric, sanitizePredictPayload, sanitizeText, validateHttpsAllowlist } from "./lib/security.ts";
import type { Investigation, Publication } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(__dirname, "../public/data/index.json");
const catalog = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as {
  investigations: Investigation[];
  publications: Publication[];
};

describe("Source-Grounded SI Pipeline & Security Evaluation Suite (4/4)", () => {
  it("1. returns DIRECT_TABLE with verified CSV citations when querying tested PMMA experiments", () => {
    const res = runGroundedPipelineSync(
      "Which experiments burned PMMA and at what oxygen levels?",
      catalog.investigations,
      catalog.publications,
    );
    assert.equal(res.status, "DIRECT_TABLE");
    assert.equal(res.refused, false);
    assert.equal(res.llmCalled, false);
    assert.ok(res.chunks.length > 0);
    assert.ok(res.chunks.some((c) => c.id === "PSI-25" && c.completeness === "TABLE_CSV_ROWS"));
    assert.ok(res.answer.includes("[S1]"));
  });

  it("2. triggers INSUFFICIENT_EVIDENCE circuit-breaker refusal BEFORE calling LLM for untested regimes (Mars 0.38g / 50% solid O2)", () => {
    const resMars = runGroundedPipelineSync(
      "Can solid PMMA burn at 50% oxygen on Mars at 0.38g?",
      catalog.investigations,
      catalog.publications,
    );
    assert.equal(resMars.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(resMars.refused, true);
    assert.equal(resMars.llmCalled, false);
    assert.ok(resMars.gapReport?.startsWith("GAP:"));
  });

  it("3. separates Relevance %, Condition Match (EXACT·PARTIAL·UNMATCHED), and Completeness (TABLE_CSV_ROWS·ABSTRACT_ONLY·METADATA_ONLY)", () => {
    const { chunks } = buildEvidenceChunks(
      "BASS-II PMMA at 21% oxygen",
      catalog.investigations,
      catalog.publications,
    );
    assert.ok(chunks.length > 0);
    const top = chunks[0];
    assert.ok(top.relevancePct > 0 && top.relevancePct <= 100);
    assert.equal(top.conditionMatch, "EXACT");
    assert.equal(top.completeness, "TABLE_CSV_ROWS");
    assert.notEqual(top.chamberO2, "not recorded");
  });

  it("4. enforces input sanitization, numeric clamping, and HTTPS/SSRF allowlist in security.ts", () => {
    assert.equal(sanitizeText("<script>alert(1)</script>PMMA\u0000"), "PMMA");
    assert.equal(clampNumeric(150, 0, 100, 21), 100);
    assert.equal(clampNumeric(-10, 0, 100, 21), 0);
    assert.equal(clampNumeric("invalid", 0, 100, 21), 21);

    assert.equal(validateHttpsAllowlist("https://psi.nasa.gov/physci/repo/data").ok, true);
    assert.equal(validateHttpsAllowlist("http://psi.nasa.gov/insecure").ok, false);
    assert.equal(validateHttpsAllowlist("https://127.0.0.1:8080/admin").ok, false);
    assert.equal(validateHttpsAllowlist("https://169.254.169.254/latest/meta-data").ok, false);
    assert.equal(validateHttpsAllowlist("https://evil.example.com/data").ok, false);

    const badPredict = sanitizePredictPayload({ o2: 34, targetUrl: "http://127.0.0.1/ssrf" });
    assert.equal(badPredict.ok, false);
    const goodPredict = sanitizePredictPayload({
      o2: 250,
      gravity: -2,
      fuel: "<b>Ethylene</b>",
      targetUrl: "https://ntrs.nasa.gov/citations/20220005716",
    });
    assert.equal(goodPredict.ok, true);
    assert.equal(goodPredict.data?.o2, 100);
    assert.equal(goodPredict.data?.gravity, 0);
    assert.equal(goodPredict.data?.fuel, "Ethylene");
  });
});

