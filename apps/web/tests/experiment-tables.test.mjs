import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { analyticsDatasets, analyticsCsv, emptyAnalyticsFilters, filterRows, normalizeTable, numericCell, plotRows } from "../src/lib/analytics.ts";
import { emptyRecordFilters, experimentRecordsCsv, filterExperimentRecords, publicationUrl, readExperimentRecords } from "../src/lib/experiment-records.ts";
import { readSaffire } from "../src/lib/saffire.ts";

const spec = (key) => analyticsDatasets.find((s) => s.key === key);
const table = (s) => JSON.parse(readFileSync(new URL(`../public/data/tables/${s.id}.json`, import.meta.url), "utf8")).find((t) => t.file_name === s.file);
const numeric = (key) => normalizeTable(table(spec(key)), spec(key));
const records = (key) => readExperimentRecords(table(spec(key)), spec(key));

test("all 22 committed experiment tables have distinct adapters and retain all 2009 original rows", () => {
  const directory = new URL("../public/data/tables/", import.meta.url);
  const actual = readdirSync(directory).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(new URL(f, directory), "utf8")));
  assert.equal(analyticsDatasets.length, 22);
  assert.equal(new Set(analyticsDatasets.map((s) => s.key)).size, 22);
  assert.equal(new Set(analyticsDatasets.map((s) => s.id)).size, 20);
  assert.deepEqual(analyticsDatasets.map((s) => s.file).sort(), actual.map((t) => t.file_name).sort());
  let total = 0;
  for (const s of analyticsDatasets) {
    const t = table(s);
    const result = s.mode === "source_records" ? readExperimentRecords(t, s)
      : s.mode === "sample_comparison" ? Object.values(readSaffire(t)).flat().sort((a, b) => a.key - b.key) : normalizeTable(t, s);
    assert.equal(result.length, t.rows.length, s.key);
    assert.deepEqual(result.map((r) => r.raw), t.rows, s.key);
    assert.deepEqual(result.map((r) => r.key), t.rows.map((_, i) => i + 1), s.key);
    total += result.length;
  }
  assert.equal(total, 2009);
});

test("Flame Design keeps ramp/LOWO2 strings out of numeric flow plots and separates oxygen bases", () => {
  const normal = numeric("flame-design-normal"); const inverse = numeric("flame-design-inverse");
  assert.equal(normal.length, 207); assert.equal(inverse.length, 120);
  assert.equal(plotRows(normal, "o2", "fuelFlow").length, 147);
  assert.equal(plotRows(inverse, "o2", "oxygenFlow").length, 109);
  assert.match(spec("flame-design-normal").metrics[0].label, /ambient/);
  assert.match(spec("flame-design-inverse").metrics[0].label, /Burner-fed/);
  assert.ok(Math.abs(inverse[0].cells.o2.value - 37.082819) < 1e-9);
  assert.equal(inverse[0].material, "Ethylene (XC2H4 source columns)");
  assert.equal(table(spec("flame-design-inverse")).columns.includes("Fuel"), false);
  assert.ok(normal.some((r) => r.cells.fuelFlow.issue === "Qualified or non-numeric"));
  assert.equal(spec("flame-design-normal").metrics.some((m) => m.column === "Tad (K)"), false);
});

test("CFI accepts only explicitly declared atm units and retains duplicate source rows", () => {
  const s = spec("cfi"); const rows = numeric("cfi"); const m = s.metrics.find((m) => m.key === "pressure");
  assert.equal(rows.length, 87); assert.equal(plotRows(rows, "o2", "pressure").length, 87);
  assert.equal(new Set(rows.map((r) => JSON.stringify(r.raw))).size, 79);
  assert.equal(rows.filter((r) => r.warnings.some((w) => /Identical/.test(w))).length, 16);
  assert.equal(rows[0].cells.pressure.value, 1); assert.equal(rows[0].cells.o2.value, 21);
  for (const value of ["1 bar", "~1 atm", "0.5 - 1 atm", "1; 2 atm", "1"]) assert.equal(numericCell(value, m).value, null);
  assert.equal(numericCell("0.75 atm", m).value, .75);
});

test("SAME-R retains aging records without inventing missing duration, oxygen or Rt/R0 measurements", () => {
  const s = spec("same-r"); const rows = numeric("same-r");
  assert.equal(rows.length, 109); assert.equal(plotRows(rows, "inletVelocity", "netAging").length, 104);
  const aged = rows.find((r) => r.categories.description === "aged");
  assert.ok(aged); assert.equal(aged.cells.duration.value, null); assert.notEqual(aged.cells.netAging.value, null);
  assert.equal(rows.filter((r) => r.testId === "57").length, 2);
  assert.equal(s.metrics.some((m) => ["o2", "pressure"].includes(m.key) || m.column === "Rt/R0"), false);
  assert.equal(filterRows(rows, { ...emptyAnalyticsFilters, o2Min: "21", pressureMin: "1" }, s).length, 109);
});

test("SPICE keeps duplicate records, zero flow and signed airflow without deriving per-row burn times", () => {
  const s = spec("spice"); const t = table(s); const rows = numeric("spice");
  assert.equal(rows.length, 469); assert.equal(new Set(rows.map((r) => JSON.stringify(r.raw))).size, 435);
  const negatives = rows.filter((r) => Number(r.raw[t.columns.indexOf("Air Rate (cm/s)")]) < 0);
  assert.equal(negatives.length, 8);
  assert.ok(negatives.every((r) => r.cells.airflow.issue === "Signed value needs source review" && r.warnings.some((w) => /Negative airflow/.test(w))));
  assert.equal(plotRows(rows, "hcFlow", "airflow").length, 436);
  assert.equal(rows.filter((r) => r.cells.hcFlow.value === 0).length, 13);
  assert.equal(s.metrics.some((m) => ["burnTime", "o2", "pressure"].includes(m.key)), false);
  const csv = analyticsCsv({ rows: negatives, table: t, spec: s, sourceUrl: "https://psi.nasa.gov/", filters: emptyAnalyticsFilters, x: "hcFlow", y: "airflow", group: "nozzle" });
  assert.match(csv, /Signed value needs source review/); assert.match(csv, /Negative airflow/);
});

test("FLEX-2 and SAME preserve coverage lists and condition references instead of creating test combinations", () => {
  const flex = records("flex-2"); const same = records("same");
  assert.equal(flex.length, 8); assert.equal(same.length, 8);
  assert.equal(flex[0].fields["Oxygen Mole Fraction"], "0.17; 0.21;0.25; 0.3");
  assert.equal(flex[0].fields["Initial Droplet Diameter (mm)"], "1.5 - 5");
  assert.equal(same.filter((r) => r.warnings.some((w) => /no synthetic test rows/.test(w))).length, 4);
  assert.equal(same[4].fields["Weight loss rate (mg/min)"], "");
  assert.equal(spec("flex-2").metrics.length, 0);
});

test("SAFFIRE-I separates flow references, while SAFFIRE-III remains a configuration table", () => {
  const first = records("saffire-i"); const third = records("saffire-iii");
  assert.equal(first.filter((r) => r.kind === "sample").length, 2);
  assert.equal(first.filter((r) => r.kind === "flow reference").length, 2);
  assert.equal(first[0].fields["Sample Thickness (cm)"], "0.37");
  assert.equal(first[0].fields["Percent O2"], "21.5 - 21.7");
  assert.equal(third.length, 2); assert.equal(third[0].fields["Sample Thickness"], ".33 cm");
  assert.equal("Burn Time (s)" in third[0].fields, false);
});

test("ACME retains genuine zero counts and missing continuation counts as different states", () => {
  const bre = records("bre"); const electric = records("e-field");
  assert.equal(bre.find((r) => r.fields["Oxygen Conc (percent)"] === "2100%").count, 0);
  assert.equal(electric.length, 32);
  assert.equal(electric.filter((r) => r.count !== null).length, 21);
  const continuation = electric.filter((r) => r.kind === "continuation");
  assert.equal(continuation.length, 11);
  assert.ok(continuation.every((r) => r.count === null && r.fields["Fuel Bottle"] === "" && r.fields["Mesh Polarity"] === ""));
});

test("questionable ACME oxygen and chemistry remain raw, visibly flagged and searchable", () => {
  const bre = records("bre"); const cld = records("cld-flame"); const sflame = records("s-flame");
  assert.equal(bre.filter((r) => r.warnings.some((w) => /exceeds 100%/.test(w))).length, 2);
  assert.ok(cld.find((r) => r.fields["Fuel Bottle"] === "40% CH5").warnings.some((w) => /chemical identity/.test(w)));
  assert.ok(sflame.find((r) => /N3/.test(r.fields["Atmosphere*"])).warnings.some((w) => /not been replaced/.test(w)));
  assert.equal(filterExperimentRecords(cld, { ...emptyRecordFilters, search: "ch5", flaggedOnly: true }, spec("cld-flame")).length, 3);
  assert.equal(filterExperimentRecords(cld, { ...emptyRecordFilters, search: "ch5", material: "100% CH5", flaggedOnly: true }, spec("cld-flame")).length, 1);
  assert.equal(filterExperimentRecords(cld, { ...emptyRecordFilters, search: "no such record" }, spec("cld-flame")).length, 0);
});

test("source record CSV retains shared notes outside the filtered subset and SAFFIRE flow references", () => {
  const s = spec("bre"); const allRows = records("bre");
  const csv = experimentRecordsCsv({ rows: [allRows[4]], allRows, table: table(s), spec: s, sourceUrl: "https://psi.nasa.gov/", filters: { ...emptyRecordFilters, search: "3400%" } });
  assert.match(csv, /3400%/); assert.match(csv, /chamber pressures were also varied/);
  assert.match(csv, /Source oxygen exceeds 100%/); assert.match(csv, /data_row_ordinal/);
  const sampleSpec = spec("saffire-i"); const sampleRows = records("saffire-i");
  const sampleCsv = experimentRecordsCsv({ rows: [sampleRows[0]], allRows: sampleRows, table: table(sampleSpec), spec: sampleSpec, sourceUrl: "https://psi.nasa.gov/", filters: emptyRecordFilters });
  assert.match(sampleCsv, /F1C1\/F1C2/); assert.match(sampleCsv, /flow_references_json/);
});

test("inventories and publication indices preserve their record meaning and safe DOI links", () => {
  assert.equal(records("bass").length, 122); assert.equal(records("daft").length, 2);
  assert.equal(records("slice").length, 12); assert.equal(records("cool-flame-index").length, 8);
  assert.equal(records("bass").filter((r) => r.warnings.some((w) => /identifier is repeated/.test(w))).length, 10);
  assert.equal(publicationUrl("http://dx.doi.org/10.1016/j.combustflame.2017.01.028"), "https://doi.org/10.1016/j.combustflame.2017.01.028");
  for (const href of ["javascript:alert(1)", "https://example.org/", "https://doi.org.evil.test/", "https://user:secret@doi.org/10.1/a"]) assert.equal(publicationUrl(href), null);
});

test("source-record adapters fail closed on wrong identity, changed schema or unknown sample kinds", () => {
  const s = spec("saffire-i"); const t = table(s);
  assert.throws(() => readExperimentRecords({ ...t, investigation_id: "PSI-99" }, s), /Unexpected source/);
  assert.throws(() => readExperimentRecords({ ...t, columns: t.columns.slice(0, -1) }, s), /Missing columns/);
  assert.throws(() => readExperimentRecords({ ...t, rows: [["unknown", ...t.rows[0].slice(1)]] }, s), /Unclassified/);
  assert.throws(() => readExperimentRecords({ ...t, rows: [t.rows[0].slice(0, -1)] }, s), /unexpected number of cells/);
});
