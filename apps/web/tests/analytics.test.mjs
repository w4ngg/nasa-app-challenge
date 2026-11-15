import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyticsCsv, analyticsDatasets, comparisonNotes, emptyAnalyticsFilters,
  filterError, filterRows, normalizeTable, numericCell, plotRows,
} from "../src/lib/analytics.ts";
import { readSaffire, saffireCsv } from "../src/lib/saffire.ts";

const flex = analyticsDatasets.find((d) => d.id === "PSI-69");
const bass = analyticsDatasets.find((d) => d.id === "PSI-25");
const sourceTable = (spec) => JSON.parse(readFileSync(new URL(`../public/data/tables/${spec.id}.json`, import.meta.url), "utf8")).find((t) => t.file_name === spec.file);
const table = sourceTable(flex);
const rows = normalizeTable(table, flex);
const metric = (key) => flex.metrics.find((m) => m.key === key);

test("reviewed fixtures retain all source rows, identity and original cells", () => {
  assert.equal(rows.length, 274);
  assert.equal(normalizeTable(sourceTable(bass), bass).length, 129);
  assert.equal(rows[0].key, 1);
  assert.equal(rows[0].testId, "1");
  assert.deepEqual(rows[0].raw, table.rows[0]);
  assert.equal(rows[0].cells.pressure.value, 757.7);
  assert.equal(rows[0].cells.o2.value, 21);
});

test("schema drift and an unreviewed source cannot silently produce measurements", () => {
  assert.throws(() => normalizeTable({ ...table, columns: table.columns.filter((c) => c !== "Burn time; s") }, flex), /Missing columns/);
  assert.throws(() => normalizeTable({ ...table, investigation_id: "PSI-68" }, flex), /Unexpected source/);
});

test("fractions are converted only by the declared adapter; BASS vol % remains unchanged", () => {
  assert.equal(numericCell("0.21", metric("o2")).value, 21);
  assert.equal(numericCell("22.2", bass.metrics[0]).value, 22.2);
  assert.equal(numericCell("2.1e-1", metric("o2")).value, 21);
});

test("missing, qualified and physically invalid values stay distinguishable", () => {
  for (const text of ["", "none", "N/A", "–", "—"]) assert.equal(numericCell(text, metric("burnTime")).issue, "Missing");
  for (const text of ["~6", "1–3", "5 4 3 2 1", "21%", "0x15", "Infinity"]) {
    assert.equal(numericCell(text, metric("burnTime")).issue, "Qualified or non-numeric");
  }
  assert.equal(numericCell("0", metric("pressure")).issue, "Outside physical bounds");
  assert.equal(numericCell("-1", bass.metrics.find((m) => m.key === "initialCO")).issue, "Outside physical bounds");
  assert.equal(numericCell("1.01", metric("o2")).value, null);
});

test("the ambiguous burning-rate field is not offered as a numeric metric", () => {
  assert.equal(flex.metrics.some((m) => m.column === "Burning rate; mm"), false);
});

test("focused subset applies fuel, oxygen, pressure and test-end together", () => {
  const filtered = filterRows(rows, { ...emptyAnalyticsFilters, material: "Methanol", category: "Extinction", o2Min: "21", o2Max: "21", pressureMin: "740", pressureMax: "780" }, flex);
  assert.equal(filtered.length, 11);
  assert.equal(plotRows(filtered, "diameter", "burnTime").length, 11);
  assert.deepEqual(filtered.map((r) => r.testId), ["2", "3", "4", "5", "6", "33", "34", "169", "170", "202", "203"]);
  for (const row of filtered) {
    assert.equal(row.material, "Methanol");
    assert.equal(row.categories.endpoint, "Extinction");
    assert.equal(row.cells.o2.value, 21);
    assert.ok(row.cells.pressure.value >= 740 && row.cells.pressure.value <= 780);
  }
});

test("numeric filtering excludes missing conditions only while the filter is active", () => {
  const source = [rows[0], { ...rows[1], cells: { ...rows[1].cells, o2: { value: null, issue: "Missing" } } }];
  assert.equal(filterRows(source, emptyAnalyticsFilters, flex).length, 2);
  assert.equal(filterRows(source, { ...emptyAnalyticsFilters, o2Min: "21", o2Max: "21" }, flex).length, 1);
});

test("invalid bounds cannot silently act as an empty or unlimited filter", () => {
  for (const patch of [{ o2Min: "22", o2Max: "21" }, { o2Min: "abc" }, { o2Max: "101" }, { o2Min: " " }, { pressureMin: "0x15" }]) {
    const filters = { ...emptyAnalyticsFilters, ...patch };
    assert.ok(filterError(filters, flex));
    assert.deepEqual(filterRows(rows, filters, flex), []);
  }
});

test("missing or qualified X/Y values are excluded per axis without dropping the source row", () => {
  const qualified = rows.find((r) => r.raw[table.columns.indexOf("Burn time; s")].startsWith("~"));
  assert.ok(qualified);
  assert.equal(qualified.cells.burnTime.value, null);
  assert.equal(plotRows([qualified], "diameter", "burnTime").length, 0);
  assert.equal(filterRows([qualified], emptyAnalyticsFilters, flex).length, 1);
  assert.equal(rows.length - plotRows(rows, "diameter", "burnTime").length, 15);
});

test("comparison explicitly identifies different endpoints and conditions", () => {
  const notes = comparisonNotes([rows[0], rows[1]], flex).join(" ");
  assert.match(notes, /Test end differs/);
  assert.match(notes, /pressure.*differs/i);
  assert.match(notes, /not established replicates/);
});

// Small parser keeps this test independent of the implementation's escaping.
function parseCsv(text) {
  const output = []; let row = []; let cell = ""; let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && ch === ",") { row.push(cell); cell = ""; }
    else if (!quoted && ch === "\r" && text[i + 1] === "\n") { row.push(cell); output.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  return output;
}

test("CSV includes filtered-but-unplottable rows, units, context, provenance and raw cells", () => {
  const missing = rows.find((r) => r.cells.burnTime.value === null);
  const csv = analyticsCsv({ rows: [rows[0], missing], table, spec: flex, sourceUrl: "https://psi.nasa.gov/source", filters: emptyAnalyticsFilters, x: "diameter", y: "burnTime", group: "endpoint" });
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 3);
  const records = parsed.slice(1).map((r) => Object.fromEntries(parsed[0].map((h, i) => [h, r[i]])));
  assert.equal(records[0]["Initial ambient O₂ (mol %)"], "21");
  assert.equal(records[0]["raw: O initial ambient composition; mole fraction"], "0.21");
  assert.equal(records[0].source_file, table.file_name);
  assert.equal(records[0].source_url, "https://psi.nasa.gov/source");
  assert.equal(records[0].data_row_ordinal, "1");
  assert.deepEqual(JSON.parse(records[0].filters_json), emptyAnalyticsFilters);
  assert.equal(records[1].plotted, "false");
  assert.match(records[1].axis_exclusion_reason, /burnTime/);
  assert.equal(records[1]["Recorded burn time (s)"], "");
});

test("CSV round-trips quoted multiline source text and neutralizes spreadsheet formulas", () => {
  const raw = [...rows[0].raw]; raw[1] = '=HYPERLINK("bad")'; raw[4] = 'A, "quoted"\nmaterial';
  const csv = analyticsCsv({ rows: [{ ...rows[0], raw }], table, spec: flex, sourceUrl: "source", filters: emptyAnalyticsFilters, x: "diameter", y: "burnTime", group: "" });
  const parsed = parseCsv(csv);
  assert.equal(parsed[1][parsed[0].indexOf("raw: FLEX Identifier")], '\'=HYPERLINK("bad")');
  assert.equal(parsed[1][parsed[0].indexOf("raw: Fuel")], 'A, "quoted"\nmaterial');
  assert.equal(parsed[0].length, parsed[1].length);
});

test("dataset identities distinguish normal/inverse tables from the same investigation", () => {
  assert.equal(new Set(analyticsDatasets.map((d) => d.key)).size, analyticsDatasets.length);
  assert.equal(analyticsDatasets.filter((d) => d.id === "PSI-159").length, 2);
});

const normal = analyticsDatasets.find((d) => d.key === "cfi-g-normal");
const inverse = analyticsDatasets.find((d) => d.key === "cfi-g-inverse");
const normalRows = normalizeTable(sourceTable(normal), normal);
const inverseRows = normalizeTable(sourceTable(inverse), inverse);

test("CFI-G keeps both source tables and oxygen bases distinct", () => {
  assert.equal(normalRows.length, 179);
  assert.equal(inverseRows.length, 154);
  assert.equal(plotRows(normalRows, "o2", "burnTime").length, 175);
  assert.equal(plotRows(inverseRows, "o2", "burnTime").length, 154);
  assert.equal(normalRows[0].cells.o2.value, 39.39);
  assert.equal(inverseRows[0].cells.o2.value, 21);
  assert.match(inverse.metrics.find((m) => m.key === "o2").label, /Burner-fed/);
  assert.equal(normalRows[0].cells.burnerTemperature.value, 290.617198);
});

test("CFI-G retains zero-duration ignition failures and normalizes only known status labels", () => {
  assert.equal(inverseRows[0].cells.burnTime.value, 0);
  assert.equal(inverseRows[0].cells.burnTime.issue, null);
  assert.equal(inverseRows[0].categories.ignition, "No");
  assert.equal(inverseRows[0].categories.endpoint, "Not classified");
  assert.equal(inverseRows.filter((r) => r.categories.ignition === "Yes").length, 131);
  assert.equal(inverseRows.filter((r) => r.categories.ignition === "No").length, 15);
  assert.equal(inverseRows.filter((r) => r.categories.ignition === "Flash (source)").length, 8);
  assert.equal(filterRows(inverseRows, { ...emptyAnalyticsFilters, ignition: "Flash (source)" }, inverse).length, 8);
  assert.equal(filterRows(normalRows, { ...emptyAnalyticsFilters, ignition: "No" }, normal).length, 47);
  assert.equal(filterRows(inverseRows, { ...emptyAnalyticsFilters, category: "Self-extinction (SE)" }, inverse).length, 81);
});

test("CFI-G missing burner temperatures remain missing and approximate pressure stays labelled", () => {
  assert.equal(plotRows(normalRows, "o2", "burnerTemperature").length, 133);
  assert.equal(plotRows(inverseRows, "o2", "burnerTemperature").length, 151);
  const csv = analyticsCsv({ rows: [inverseRows[0]], table: sourceTable(inverse), spec: inverse, sourceUrl: "source", filters: emptyAnalyticsFilters, x: "pressure", y: "burnTime", group: "ignition" });
  const parsed = parseCsv(csv);
  assert.equal(parsed[1][parsed[0].indexOf("pressure_quality")], "Numeric value from approximate source column");
  assert.equal(parsed[1][parsed[0].indexOf("Approximate ambient pressure (bar)")], "1.1");
  assert.equal(parsed[1][parsed[0].indexOf("plotted")], "true");
  assert.equal(parsed[1][parsed[0].indexOf("Recorded burn time (s)")], "0");
});

const saffire = analyticsDatasets.find((d) => d.key === "saffire-ii");
const saffireTable = sourceTable(saffire);
const saffireData = readSaffire(saffireTable);

test("SAFFIRE-II separates nine samples from two flow references and four notes", () => {
  assert.equal(saffireData.samples.length, 9);
  assert.equal(saffireData.references.length, 2);
  assert.equal(saffireData.notes.length, 4);
  assert.deepEqual(saffireData.samples.map((r) => r.sampleId), ["2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-7", "2-8", "2-9"]);
  assert.deepEqual(saffireData.samples[0].raw, saffireTable.rows[0]);
  assert.equal(saffireData.references[0].key, 10);
  assert.equal(saffireData.notes[0].key, 12);
});

test("SAFFIRE-II preserves ambiguous geometry, empty material and qualitative outcomes", () => {
  const byId = (id) => saffireData.samples.find((r) => r.sampleId === id);
  assert.equal(byId("2-6").fields.Material, "");
  assert.equal(byId("2-6").fields["Samle Thickness"], "037 mm");
  assert.match(byId("2-6").warnings.join(" "), /blank.*ambiguous.*Spread Length/s);
  assert.equal(byId("2-1").fields["Burn Time (s)"], "Insignificant");
  assert.match(byId("2-1").warnings.join(" "), /not a zero/);
  assert.equal(byId("2-5").fields["?-g Spread Length"], "2.1 mm/s");
  assert.equal(byId("2-8").fields["Samle Thickness"], "See Fig. 5");
  assert.match(byId("2-8").warnings.join(" "), /figure/);
});

test("SAFFIRE-II rejects unknown row kinds and schema drift", () => {
  assert.throws(() => readSaffire({ ...saffireTable, rows: [...saffireTable.rows, ["Unclassified"]] }), /Unclassified/);
  assert.throws(() => readSaffire({ ...saffireTable, columns: saffireTable.columns.filter((c) => c !== "Burn Time (s)") }), /Missing columns/);
});

test("SAFFIRE-II sample CSV carries source notes without adding fabricated values", () => {
  const sample = saffireData.samples.find((r) => r.sampleId === "2-6");
  const csv = saffireCsv({ rows: [sample], data: saffireData, table: saffireTable, sourceUrl: "source", material: "Not recorded", direction: "Concurrent" });
  const parsed = parseCsv(csv);
  const record = Object.fromEntries(parsed[0].map((h, i) => [h, parsed[1][i]]));
  assert.equal(parsed.length, 2);
  assert.equal(record.record_kind, "sample");
  assert.equal(record["raw: Material"], "");
  assert.equal(record["raw: Samle Thickness"], "037 mm");
  assert.equal(record["raw: ?-g Spread Length"], "2.6 mm/s");
  assert.equal(record.source_notes.split("\n").length, 4);
  assert.match(record.source_notes, /Derived from measured CO2/);
  assert.equal(record.data_row_ordinal, "6");
  assert.equal(JSON.parse(record.filters_json).material, "Not recorded");
});
