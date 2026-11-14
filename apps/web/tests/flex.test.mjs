import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyticsDatasets, normalizeTable } from "../src/lib/analytics.ts";
import { historySegments, parseFlexHistory, parseFlexIndex, summaryForRow } from "../src/lib/flex.ts";

const read = (path) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), "utf8"));
const index = parseFlexIndex(read("flex/summaries.json"));
const spec = analyticsDatasets.find((d) => d.id === "PSI-69");
const table = read("tables/PSI-69.json").find((t) => t.file_name === spec.file);
const rows = normalizeTable(table, spec);
const entry = (id) => index.tests.find((t) => t.test_id === String(id));

test("every FLEX catalog record has a summary with an exact original-row identity match", () => {
  assert.equal(index.tests.length, 274);
  assert.equal(new Set(index.tests.map((t) => t.test_id)).size, 274);
  for (const row of rows) {
    const summary = summaryForRow(index, row, table);
    assert.ok(summary, `Missing summary for test ${row.testId}`);
    assert.equal(summary.cir_id, row.raw[1]);
    assert.deepEqual(summary.catalog_row, row.raw);
    assert.ok(summary.summary.length > 80);
    assert.ok(summary.sources.every((s) => s.file_id && /^[a-f0-9]{64}$/.test(s.sha256)));
  }
});

test("a coincidentally equal test number cannot attach a stale or other-investigation summary", () => {
  assert.equal(summaryForRow(index, rows[34], { ...table, investigation_id: "PSI-25" }), null);
  const changed = [...rows[34].raw]; changed[4] = "Methanol";
  assert.equal(summaryForRow(index, { ...rows[34], raw: changed }, table), null);
  assert.throws(() => parseFlexIndex({ ...index, investigation_id: "PSI-68" }));
  assert.throws(() => parseFlexIndex({ ...index, tests: [...index.tests, index.tests[0]] }));
});

test("file numbering is resolved by CIR; folder-label mistakes do not move the wrong experiment", () => {
  assert.equal(entry(157).cir_id, "C05M101");
  assert.equal(entry(157).source_test_id, "158");
  assert.equal(entry(157).name, "FLEX-158");
  assert.ok(entry(157).sources.some((s) => s.name.includes("FLEX-158_DropletData")));
  assert.ok(!entry(157).sources.some((s) => s.name.includes("FLEX-157_")));
  assert.equal(entry(13).cir_id, "256R002");
  assert.equal(entry(13).source_test_id, "13");
  assert.match(entry(13).source_conflicts.join(" "), /256R001/);
  assert.equal(entry(274).cir_id, "H19H201");
  assert.equal(entry(274).source_test_id, "280");
});

test("conflicting copied notes and source conditions are exposed without inventing a correction", () => {
  assert.equal(entry(128).researcher_notes, null);
  assert.match(entry(128).source_conflicts.join(" "), /C13M301/);
  assert.ok(entry(128).history_path);
  assert.match(entry(157).source_conflicts.join(" "), /catalog 0.16; TestSheet 0.18/);
  assert.equal(entry(157).conditions.find((c) => c.label === "Initial O₂").value, "16 mol %");
  assert.match(entry(70).researcher_excerpt, /unknown whether/);
  assert.match(entry(73).researcher_excerpt, /not enough evidence/);
  assert.match(entry(70).limits.join(" "), /independent replicates/);
});

test("catalog-only tests retain missing evidence instead of borrowing another test's notes or traces", () => {
  assert.equal(index.coverage.catalog_only, 2);
  for (const id of [9, 12]) {
    const summary = entry(id);
    assert.equal(summary.coverage, "catalog_only");
    assert.equal(summary.source_test_id, null);
    assert.equal(summary.history_path, null);
    assert.equal(summary.researcher_excerpt, null);
    assert.equal(summary.sources.length, 1);
    assert.ok(summary.limits.length);
  }
});

test("FLEX-035 retains its measured history and the reviewed calculation only on that case", () => {
  const selected = entry(35);
  const history = parseFlexHistory(read(`flex/${selected.history_path}`), selected);
  assert.equal(history.series.droplet.points.length, 1165);
  assert.equal(history.recorded_endpoint_s, 8.9);
  assert.equal(history.display_end_s, 37.5);
  const at30 = history.series.droplet.points.find(([t]) => t === 30);
  assert.ok(Math.abs(at30[1] - 1.754411481715123) < 1e-12);
  assert.equal(history.fits[0].points, 581);
  assert.ok(Math.abs(history.fits[0].k_mm2_s - 0.37379113574672646) < 1e-12);
  assert.throws(() => parseFlexHistory(history, entry(34)), /does not match/);
  assert.throws(() => parseFlexHistory({ ...history, series: { droplet: { ...history.series.droplet, source_file_id: "another-source" } } }, selected), /source identity/);
});

test("every published history belongs to its selected test and preserves absent channels", () => {
  let count = 0;
  for (const summary of index.tests) {
    if (!summary.history_path) continue;
    const history = parseFlexHistory(read(`flex/${summary.history_path}`), summary);
    assert.equal(history.test_id, summary.test_id);
    for (const series of Object.values(history.series)) {
      assert.equal(series.points.length, series.count);
      assert.ok(summary.sources.some((s) => s.role === series.source_role && s.file_id === series.source_file_id && s.sha256 === series.source_sha256));
    }
    if (summary.test_id !== "35") assert.deepEqual(history.fits, []);
    count++;
  }
  assert.equal(count, index.coverage.with_history);
});

test("history plots break at missing, reversed and widely separated samples without adding zeros", () => {
  const series = { points: [[0, 2], [.03, 1.9], [.06, null], [.09, 1.8], [4, 1.6], [3, 1.5], [5, 1.4]], gap_limit_s: .25 };
  assert.deepEqual(historySegments(series), [[[0, 2], [.03, 1.9]], [[.09, 1.8]], [[4, 1.6]], [[3, 1.5]], [[5, 1.4]]]);
  assert.deepEqual(historySegments(series, .1), [[[0, 2], [.03, 1.9]], [[.09, 1.8]]]);
});
