import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyticsDatasets, normalizeTable } from "../src/lib/analytics.ts";
import { bassSummaryForRow, parseBassIndex } from "../src/lib/bass.ts";

const read = (path) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), "utf8"));
const index = parseBassIndex(read("bass-ii/summaries.json"));
const spec = analyticsDatasets.find((s) => s.key === "bass-ii");
const table = read("tables/PSI-25.json").find((t) => t.file_name === spec.file);
const rows = normalizeTable(table, spec);
const entry = (id) => index.tests.find((t) => t.test_id === id);

test("all 129 BASS-II source rows have exact investigator/test/sample/date summary matches", () => {
  assert.equal(index.tests.length, 129);
  assert.equal(index.coverage.reported_results, 20);
  assert.equal(index.coverage.with_spread_rates, 18);
  assert.equal(index.coverage.with_notes, 1);
  for (const row of rows) {
    const summary = bassSummaryForRow(index, row, table);
    assert.ok(summary, `No verified summary for ${row.testId}`);
    assert.equal(summary.test_id, row.testId);
    assert.deepEqual(summary.catalog_row, row.raw);
    assert.equal(summary.time_series, null);
    assert.ok(summary.sources.every((s) => /^[a-f0-9]{64}$/.test(s.sha256)));
  }
});

test("a stale catalog or schema cannot attach a summary by a coincidentally equal test ID", () => {
  const row = rows.find((r) => r.testId === "M8");
  assert.equal(bassSummaryForRow(index, row, { ...table, investigation_id: "PSI-69" }), null);
  assert.equal(bassSummaryForRow(index, row, { ...table, file_name: "another.csv" }), null);
  assert.equal(bassSummaryForRow(index, row, { ...table, columns: [...table.columns].reverse() }), null);
  for (const column of ["PI", "Sample #", "Date", "Calibrated initial O2 % by vol"]) {
    const raw = [...row.raw]; raw[table.columns.indexOf(column)] = "changed";
    assert.equal(bassSummaryForRow(index, { ...row, raw }, table), null, column);
  }
});

test("M8 preserves report geometry, original flow text, notes and source disagreements", () => {
  const m8 = entry("M8");
  assert.equal(m8.reported_result.width_cm, 1.2);
  assert.match(m8.conditions.find((c) => c.label === "Material description (catalog)").value, /1 cm wide/);
  assert.match(m8.conditions.find((c) => c.label.startsWith("Air display")).value, /5>7/);
  assert.equal(m8.reported_result.burn_time_min, 25.2);
  assert.deepEqual(m8.reported_result.flow_spread_pairs, [{ airflow_cm_s: 10, spread_rate_mm_s: .057 }, { airflow_cm_s: 6, spread_rate_mm_s: .056 }, { airflow_cm_s: 5, spread_rate_mm_s: .04 }]);
  assert.match(m8.source_conflicts.join(" "), /1 cm.*1.2 cm/);
  assert.match(m8.researcher_notes, /went out at pot 0.4/);
  assert.match(m8.interpretation, /not an airflow measurement/);
  assert.match(m8.sources.find((s) => s.key === "table5_1").url, /#page=65$/);
  assert.match(m8.sources.find((s) => s.key === "notes").url, /#page=117$/);
});

test("not tracked spread rates and catalog-only evidence remain explicitly missing", () => {
  for (const id of ["M6", "M12"]) {
    assert.equal(entry(id).reported_result.spread_status, "Not tracked");
    assert.ok(entry(id).reported_result.flow_spread_pairs.every((p) => p.spread_rate_mm_s === null));
  }
  assert.equal(index.tests.filter((t) => t.coverage === "catalog_only").length, 109);
  for (const record of index.tests.filter((t) => t.coverage === "catalog_only")) {
    assert.equal(record.reported_result, null);
    assert.equal(record.researcher_notes, null);
    assert.deepEqual(record.sources.map((s) => s.key), ["catalog"]);
  }
});

test("M8 calculations keep concentration percentage points separate from relative percent", () => {
  const metrics = Object.fromEntries(entry("M8").derived_metrics.map((m) => [m.key, m]));
  assert.equal(metrics.delta_o2.value, -.9); assert.equal(metrics.delta_o2.unit, "percentage points");
  assert.equal(metrics.delta_co2.value, .84); assert.equal(metrics.delta_co.value, 415);
  assert.equal(metrics.burn_time_s.value, 1512);
  assert.ok(Math.abs(metrics.spread_change_5_vs_10.value + 29.8245614035) < 1e-9);
  assert.equal(metrics.spread_change_5_vs_10.unit, "%");
  assert.ok(Object.values(metrics).every((m) => m.formula && m.inputs.length && m.source_key));
});

test("qualified, missing and negative sensor readings stay raw and out of derived differences", () => {
  const cells = index.tests.flatMap((t) => t.gas_readings.flatMap((g) => [g.initial, g.final]));
  assert.ok(cells.some((c) => c.raw === "OR" && c.value === null && c.issue));
  assert.ok(cells.some((c) => c.raw === ">500" && c.value === null && c.issue));
  assert.ok(cells.some((c) => c.raw === "-1" && c.value === null && c.issue));
  assert.ok(cells.some((c) => c.raw === "0" && c.value === 0 && c.issue === null));
  for (const t of index.tests) for (const g of t.gas_readings) {
    if (g.initial.value === null || g.final.value === null) assert.ok(!t.derived_metrics.some((m) => m.key === `delta_${g.key}`));
  }
});

test("the summary parser rejects wrong identity, source provenance, malformed plots and fabricated histories", () => {
  const mutate = (edit) => { const data = structuredClone(index); edit(data, data.tests.find((t) => t.test_id === "M8")); return data; };
  for (const data of [
    { ...index, investigation_id: "PSI-68" }, { ...index, tests: [...index.tests, index.tests[0]] },
    mutate((d, t) => { t.sample_id = "someone else's sample"; }),
    mutate((d, t) => { t.reported_result.flow_spread_pairs[0].spread_rate_mm_s = Infinity; }),
    mutate((d, t) => { t.gas_readings[0].initial.value = 25; }),
    mutate((d, t) => { t.sources[0].sha256 = "unverified"; }),
    mutate((d, t) => { t.sources[1].url = "https://example.org/report.pdf"; }),
    mutate((d, t) => { t.time_series = [[0, 19.1], [1512, 18.2]]; }),
    mutate((d, t) => { t.derived_metrics[0].source_key = "unknown"; }),
  ]) assert.throws(() => parseBassIndex(data), /schema/);
});
