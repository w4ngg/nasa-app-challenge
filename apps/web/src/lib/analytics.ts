import type { ExperimentalTable } from "../types";
import { additionalAnalyticsDatasets } from "./analytics-datasets.ts";

export interface Metric {
  key: string;
  label: string;
  unit: string;
  column: string;
  factor?: number;
  min: number;
  max?: number;
  exclusiveMin?: boolean;
  approximate?: boolean;
  unitSuffix?: string;
  negativeNeedsReview?: boolean;
}

export interface DatasetSpec {
  key: string;
  id: string;
  name: string;
  file: string;
  description: string;
  limits: string;
  idColumn: string;
  materialColumn: string;
  fixedMaterial?: string;
  categories: { key: string; label: string; column: string; labels?: Record<string, string>; groupable?: boolean }[];
  mode?: "sample_comparison" | "source_records";
  recordKind?: "samples" | "coverage" | "daily" | "inventory" | "publications";
  recordColumns?: string[];
  displayColumns?: string[];
  countColumn?: string;
  metrics: Metric[];
  defaultX: string;
  defaultY: string;
  defaultGroup: string;
}

// Deliberate adapters: a numeric-looking cell is not sufficient evidence that a
// table contains independent runs, compatible units, or the requested quantity.
export const analyticsDatasets: DatasetSpec[] = [
  {
    key: "flex", id: "PSI-69", name: "FLEX · liquid droplets",
    file: "PSI-69_Experimental table_FLEX.csv",
    description: "Individual droplet tests: initial diameter, visible flame extinction diameter, burn time and ambient conditions.",
    limits: "Burn time is the duration recorded at the listed test end. Disruption, completion and extinction are different endpoints. This table has no calibrated airflow column. Open a test summary to check time histories, researcher notes, source-specific units and fitting intervals.",
    idColumn: "FLEX Test #", materialColumn: "Fuel",
    categories: [{ key: "endpoint", label: "Test end", column: "Test end" }],
    metrics: [
      { key: "diameter", label: "Initial droplet diameter", unit: "mm", column: "Droplet initial diameter; mm", min: 0, exclusiveMin: true },
      { key: "burnTime", label: "Recorded burn time", unit: "s", column: "Burn time; s", min: 0, exclusiveMin: true },
      { key: "extinctionDiameter", label: "Visible flame extinction diameter", unit: "mm", column: "Visible flame extinction diameter; mm", min: 0, exclusiveMin: true },
      { key: "o2", label: "Initial ambient O₂", unit: "mol %", column: "O initial ambient composition; mole fraction", factor: 100, min: 0, max: 100 },
      { key: "pressure", label: "Ambient pressure", unit: "mmHg", column: "Ambient pressure; mmHg", min: 0, exclusiveMin: true },
    ],
    defaultX: "diameter", defaultY: "burnTime", defaultGroup: "endpoint",
  },
  {
    key: "bass-ii", id: "PSI-25", name: "BASS-II · solid samples",
    file: "PSI-25_Experimental table_BASS-II.csv",
    description: "Per-test calibrated gas readings before and after burning solid samples. Material descriptions are kept exactly as recorded.",
    limits: "These catalog gas readings do not measure flame spread or establish a flammability limit. Air display is documented in cm/s with a slow response; source sequences are not single constant velocities. Fan/pot settings require the relevant calibration before conversion to airflow. Open a test summary for any separately reviewed report outcomes. Missing material descriptions are not inferred from nearby rows.",
    idColumn: "Test #", materialColumn: "Fuel Sample Material",
    categories: [{ key: "pi", label: "Investigator", column: "PI" }],
    metrics: [
      { key: "o2", label: "Initial calibrated O₂", unit: "vol %", column: "Calibrated initial O2 % by vol", min: 0, max: 100 },
      { key: "finalO2", label: "Final calibrated O₂", unit: "vol %", column: "Calibrated final O2 % by vol", min: 0, max: 100 },
      { key: "initialCO2", label: "Initial CO₂", unit: "vol %", column: "Initial CO2 % by vol", min: 0, max: 100 },
      { key: "finalCO2", label: "Final CO₂", unit: "vol %", column: "Final CO2 % by vol", min: 0, max: 100 },
      { key: "initialCO", label: "Initial CO", unit: "ppm", column: "Initial CO (ppm)", min: 0 },
      { key: "finalCO", label: "Final CO", unit: "ppm", column: "Final CO (ppm)", min: 0 },
    ],
    defaultX: "o2", defaultY: "finalO2", defaultGroup: "pi",
  },
  {
    key: "cfi-g-normal", id: "PSI-159", name: "CFI-G · normal flames",
    file: "PSI-159_Experimental table_CFI-G_Normal Flames.csv",
    description: "Gas-flame tests with ambient oxygen, approximate pressure, recorded burn time, hot-ignition status and peak burner temperature.",
    limits: "Pressure is labelled approximate in the source. Peak burner temperature is not flame temperature. Zero burn times are retained alongside hot-ignition status; failed ignition is not proof of non-flammability. Self-extinction (SE) and flow termination (FT) are different endpoints. Blank ‘Cool flame?’ cells are not interpreted as No.",
    idColumn: "Test", materialColumn: "Fuel",
    categories: [
      { key: "endpoint", label: "Test end", column: "Self-ext or flow term", labels: { se: "Self-extinction (SE)", ft: "Flow terminated (FT)", "-": "Not classified" } },
      { key: "ignition", label: "Hot ignition", column: "Hot ignition", labels: { yes: "Yes", no: "No", flash: "Flash (source)" } },
    ],
    metrics: [
      { key: "o2", label: "Initial ambient O₂", unit: "mol %", column: "XO2 before test", factor: 100, min: 0, max: 100 },
      { key: "finalO2", label: "Final ambient O₂", unit: "mol %", column: "XO2 after test", factor: 100, min: 0, max: 100 },
      { key: "burnTime", label: "Recorded burn time", unit: "s", column: "burn time (sec)", min: 0 },
      { key: "pressure", label: "Approximate ambient pressure", unit: "bar", column: "approx p (bar)", min: 0, exclusiveMin: true, approximate: true },
      { key: "burnerTemperature", label: "Peak burner temperature", unit: "°C", column: "Peak burner T (C )", min: -273.15, exclusiveMin: true },
      { key: "fuelFlow", label: "Hydrocarbon mass flow", unit: "mg/s", column: "mHC (mg/s)", min: 0 },
    ],
    defaultX: "o2", defaultY: "burnTime", defaultGroup: "endpoint",
  },
  {
    key: "cfi-g-inverse", id: "PSI-159", name: "CFI-G · inverse flames",
    file: "PSI-159_Experimental table_CFI-G_Inverse Flames.csv",
    description: "Inverse gas-flame tests: oxygen is supplied through the burner into a fuel-containing atmosphere. This oxygen fraction is not cabin oxygen.",
    limits: "Burner-fed oxygen must not be interpreted as ambient cabin oxygen or combined with normal-flame oxygen. Pressure is labelled approximate in the source. Zero burn times and flash ignition are preserved. Self-extinction (SE) and flow termination (FT) are different endpoints; burner temperature is not flame temperature.",
    idColumn: "Test", materialColumn: "Fuel",
    categories: [
      { key: "endpoint", label: "Test end", column: "Self -ext or flow term", labels: { se: "Self-extinction (SE)", ft: "Flow terminated (FT)", "-": "Not classified" } },
      { key: "ignition", label: "Hot ignition", column: "Hot ignition", labels: { yes: "Yes", no: "No", flash: "Flash (source)" } },
    ],
    metrics: [
      { key: "o2", label: "Burner-fed O₂", unit: "mol %", column: "XO2", factor: 100, min: 0, max: 100 },
      { key: "burnTime", label: "Recorded burn time", unit: "s", column: "burn time (sec)", min: 0 },
      { key: "pressure", label: "Approximate ambient pressure", unit: "bar", column: "approx p (bar)", min: 0, exclusiveMin: true, approximate: true },
      { key: "burnerTemperature", label: "Peak burner temperature", unit: "°C", column: "Peak burner Temp (C)", min: -273.15, exclusiveMin: true },
      { key: "fuelBurnrate", label: "HC burnrate (source)", unit: "mg/s", column: "HC burnrate (mg/s)", min: 0 },
      { key: "oxygenFlow", label: "O₂ mass flow", unit: "mg/s", column: "O2 flow rate (mg/s)", min: 0 },
    ],
    defaultX: "o2", defaultY: "burnTime", defaultGroup: "endpoint",
  },
  {
    key: "saffire-ii", id: "PSI-99", name: "SAFFIRE-II · sample comparison",
    file: "PSI-99_Experimental table_SAFFIRE-2.csv", mode: "sample_comparison",
    description: "Nine sample records with source-reported burn and spread outcomes, alongside 1-g reference results and four explanatory notes.",
    limits: "Source strings and qualifiers are preserved. Ambiguous thicknesses, missing material names and inconsistent spread-column headings are flagged for review. These nine samples are not a validated material ranking or a predictive model.",
    idColumn: "Sample Number", materialColumn: "Material",
    categories: [{ key: "direction", label: "Flow direction", column: "Flow Direction" }],
    metrics: [], defaultX: "", defaultY: "", defaultGroup: "",
  },
  ...additionalAnalyticsDatasets,
];

export type CellIssue = "Missing" | "Qualified or non-numeric" | "Outside physical bounds" | "Signed value needs source review";
export interface NumericCell { value: number | null; issue: CellIssue | null }
const scalarNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Never parse a range, an approximate value, a list, or a display sequence as an exact measurement. */
export function numericCell(raw: string, metric: Metric): NumericCell {
  let text = raw.trim();
  if (metric.unitSuffix && text.endsWith(metric.unitSuffix)) text = text.slice(0, -metric.unitSuffix.length).trim();
  else if (metric.unitSuffix) return { value: null, issue: text ? "Qualified or non-numeric" : "Missing" };
  if (!text || /^(?:n\/?a|none|null|[-–—])$/i.test(text)) return { value: null, issue: "Missing" };
  if (!scalarNumber.test(text)) {
    return { value: null, issue: "Qualified or non-numeric" };
  }
  const value = Number(text) * (metric.factor ?? 1);
  if (metric.negativeNeedsReview && value < 0) return { value: null, issue: "Signed value needs source review" };
  if (!Number.isFinite(value) || value < metric.min || (metric.exclusiveMin && value === metric.min)
      || (metric.max !== undefined && value > metric.max)) {
    return { value: null, issue: "Outside physical bounds" };
  }
  return { value, issue: null };
}

export interface AnalyticsRow {
  key: number;
  testId: string;
  material: string;
  categories: Record<string, string>;
  cells: Record<string, NumericCell>;
  raw: string[];
  warnings: string[];
}

export function validateAnalyticsTable(table: ExperimentalTable, spec: DatasetSpec): void {
  if (table.investigation_id !== spec.id || table.file_name !== spec.file) throw new Error("Unexpected source table.");
  const required = [spec.idColumn, ...(spec.fixedMaterial ? [] : [spec.materialColumn]), ...spec.metrics.map((m) => m.column), ...spec.categories.map((c) => c.column), ...(spec.recordColumns ?? [])];
  const missing = required.filter((column) => !table.columns.includes(column));
  if (missing.length) throw new Error(`The source schema changed. Missing columns: ${missing.join(", ")}`);
  if (table.rows.some((row) => row.length !== table.columns.length)) throw new Error("The source contains a row with an unexpected number of cells.");
}

export function normalizeTable(table: ExperimentalTable, spec: DatasetSpec): AnalyticsRow[] {
  validateAnalyticsTable(table, spec);
  const indexes = new Map(table.columns.map((c, i) => [c, i]));
  const occurrences = new Map<string, number>();
  table.rows.forEach((raw) => { const signature = JSON.stringify(raw); occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1); });
  const ids = new Map<string, number>();
  table.rows.forEach((raw) => { const id = raw[indexes.get(spec.idColumn)!]?.trim(); if (id) ids.set(id, (ids.get(id) ?? 0) + 1); });
  return table.rows.map((raw, index) => {
    const get = (column: string) => raw[indexes.get(column)!]?.trim() ?? "";
    return {
      key: index + 1, // 1-based data-row ordinal in the exported table, not a CSV physical line number.
      testId: get(spec.idColumn) || `Unlabelled row ${index + 1}`,
      material: spec.fixedMaterial ?? (get(spec.materialColumn) || "Not recorded"),
      categories: Object.fromEntries(spec.categories.map((c) => {
        const value = get(c.column);
        return [c.key, c.labels?.[value.toLowerCase()] ?? (value || "Not recorded")];
      })),
      cells: Object.fromEntries(spec.metrics.map((m) => [m.key, numericCell(get(m.column), m)])),
      raw,
      warnings: [
        ...((occurrences.get(JSON.stringify(raw)) ?? 0) > 1 ? ["Identical source row occurs more than once; retained without deduplication."] : []),
        ...((ids.get(get(spec.idColumn)) ?? 0) > 1 ? ["Source identifier is repeated; use the data-row ordinal to identify this record."] : []),
        ...(spec.key === "spice" && get("Air Rate (cm/s)").startsWith("-") ? ["Negative airflow is preserved in the source. Its sign or calibration needs verification before plotting."] : []),
      ],
    };
  });
}

export interface AnalyticsFilters {
  material: string;
  category: string;
  ignition: string;
  o2Min: string;
  o2Max: string;
  pressureMin: string;
  pressureMax: string;
}

export const emptyAnalyticsFilters: AnalyticsFilters = {
  material: "", category: "", ignition: "", o2Min: "", o2Max: "", pressureMin: "", pressureMax: "",
};

export function filterError(filters: AnalyticsFilters, spec: DatasetSpec): string | null {
  const ranges = spec.metrics.some((m) => m.key === "o2") ? [{ label: "O₂", low: filters.o2Min, high: filters.o2Max, min: 0, max: 100 }] : [];
  if (spec.metrics.some((m) => m.key === "pressure")) {
    ranges.push({ label: "Pressure", low: filters.pressureMin, high: filters.pressureMax, min: 0, max: Infinity });
  }
  for (const range of ranges) {
    for (const text of [range.low, range.high]) {
      if (text !== "" && (!scalarNumber.test(text.trim()) || !Number.isFinite(Number(text)) || Number(text) < range.min || Number(text) > range.max)) {
        return `${range.label}: enter a number between ${range.min} and ${range.max === Infinity ? "a finite upper limit" : range.max}.`;
      }
    }
    if (range.low !== "" && range.high !== "" && Number(range.low) > Number(range.high)) return `${range.label}: minimum must not exceed maximum.`;
  }
  return null;
}

export function filterRows(rows: AnalyticsRow[], filters: AnalyticsFilters, spec: DatasetSpec): AnalyticsRow[] {
  if (filterError(filters, spec)) return [];
  const inRange = (row: AnalyticsRow, key: string, low: string, high: string) => {
    if (low === "" && high === "") return true;
    const value = row.cells[key]?.value;
    return value != null && (low === "" || value >= Number(low)) && (high === "" || value <= Number(high));
  };
  return rows.filter((row) => (!filters.material || row.material === filters.material)
    && (!filters.category || row.categories[spec.categories[0]?.key] === filters.category)
    && (!filters.ignition || row.categories.ignition === filters.ignition)
    && (!spec.metrics.some((m) => m.key === "o2") || inRange(row, "o2", filters.o2Min, filters.o2Max))
    && (!spec.metrics.some((m) => m.key === "pressure") || inRange(row, "pressure", filters.pressureMin, filters.pressureMax)));
}

export function plotRows(rows: AnalyticsRow[], x: string, y: string): AnalyticsRow[] {
  return rows.filter((r) => r.cells[x]?.value != null && r.cells[y]?.value != null);
}

export const metricLabel = (metric: Metric) => `${metric.label} (${metric.unit})`;
export const displayNumber = (n: number | null) => n === null ? "—" : Number(n.toPrecision(7)).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function comparisonNotes(rows: AnalyticsRow[], spec: DatasetSpec): string[] {
  if (rows.length < 2) return [];
  const notes = ["Descriptive comparison only. These runs are not established replicates or a controlled estimate of an effect."];
  if (new Set(rows.map((r) => r.material)).size > 1) notes.push("Material or fuel differs between the selected rows.");
  for (const category of spec.categories) {
    if (new Set(rows.map((r) => r.categories[category.key])).size > 1) notes.push(`${category.label} differs between the selected rows.`);
  }
  for (const key of ["o2", "pressure"]) {
    if (spec.metrics.some((m) => m.key === key) && new Set(rows.map((r) => r.cells[key].value)).size > 1) {
      notes.push(`${spec.metrics.find((m) => m.key === key)!.label} differs or is missing. Inspect the source conditions before interpreting the difference.`);
    }
  }
  notes.push(spec.id === "PSI-69" ? "Other ambient gas fractions may differ; review the complete source rows."
    : spec.id === "PSI-159" ? "Fuel composition and gas-flow settings may differ. Pressure is approximate; review the complete source rows."
      : spec.id === "PSI-25" ? "Sample geometry, fan and air display settings may differ; review the complete source rows."
        : spec.limits);
  return notes;
}

/** Spreadsheet-safe RFC 4180 cells. Raw data remains visible in the application. */
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function analyticsCsv({ rows, table, spec, sourceUrl, filters, x, y, group }: {
  rows: AnalyticsRow[]; table: ExperimentalTable; spec: DatasetSpec; sourceUrl: string;
  filters: AnalyticsFilters; x: string; y: string; group: string;
}): string {
  const header = ["investigation_id", "source_file", "source_url", "data_row_ordinal", "test_id", "material",
    "selected_x", "selected_y", "group_by", "filters_json", "plotted", "axis_exclusion_reason", "review_flags", "material_basis", "interpretation_limits",
    ...spec.metrics.flatMap((m) => [metricLabel(m), `${m.key}_quality`]), ...table.columns.map((c) => `raw: ${c}`)];
  const data = rows.map((row) => [spec.id, table.file_name, sourceUrl, String(row.key), row.testId, row.material,
    metricLabel(spec.metrics.find((m) => m.key === x)!), metricLabel(spec.metrics.find((m) => m.key === y)!), group || "none", JSON.stringify(filters),
    String(row.cells[x].value !== null && row.cells[y].value !== null),
    [x, y].filter((k, i, all) => all.indexOf(k) === i && row.cells[k].issue).map((k) => `${k}: ${row.cells[k].issue}`).join("; "),
    row.warnings.join("\n"), spec.fixedMaterial ? "Fixed adapter label from XC2H4 source columns" : `Source column: ${spec.materialColumn}`, spec.limits,
    ...spec.metrics.flatMap((m) => [row.cells[m.key].value === null ? "" : String(row.cells[m.key].value), row.cells[m.key].issue ?? (m.approximate ? "Numeric value from approximate source column" : "Exact numeric cell")]),
    ...table.columns.map((_, i) => row.raw[i] ?? "")]);
  return "\uFEFF" + [header, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
