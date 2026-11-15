import type { AnalyticsRow } from "./analytics";
import type { ExperimentalTable } from "../types";

export interface BassSource {
  key: "catalog" | "table5_1" | "notes" | "readme";
  name: string; role: string; locator: string; url: string; download_url: string;
  file_id: string; file_version: number; sha256: string;
}
export interface BassReading { raw: string; value: number | null; issue: string | null }
export interface BassGas {
  key: "o2" | "co2" | "co"; label: string; unit: "vol %" | "ppm";
  initial: BassReading; final: BassReading; source_key: "catalog";
}
export interface BassResult {
  thickness_mm: number; width_cm: number; burning_sides: number; burn_time_min: number;
  flow_spread_pairs: { airflow_cm_s: number; spread_rate_mm_s: number | null }[];
  spread_status: "reported" | "Not tracked"; source_key: "table5_1";
}
export interface BassDerivedMetric {
  key: string; label: string; value: number; unit: string; formula: string; inputs: string[]; source_key: "catalog" | "table5_1";
}
export interface BassTestSummary {
  test_id: string; pi: string; sample_id: string; date: string; row_ordinal: number; catalog_row: string[];
  coverage: "catalog_only" | "reported_results" | "results_and_notes";
  summary: string; conditions: { label: string; value: string; source_key: "catalog" }[];
  gas_readings: BassGas[]; reported_result: BassResult | null; derived_metrics: BassDerivedMetric[];
  researcher_notes: string | null; interpretation: string | null; source_conflicts: string[];
  limits: string[]; sources: BassSource[]; time_series: null;
}
export interface BassIndex {
  schema_version: number; investigation_id: "PSI-25"; investigation_version: number;
  source_snapshot: string; catalog_file: string; catalog_sha256: string; reviewed_source_sha256: string;
  catalog_columns: string[]; method: string; tests: BassTestSummary[];
  measurement_guide: BassSource;
  coverage: { tests: number; reported_results: number; with_spread_rates: number; with_notes: number; catalog_only: number };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalText = (value: unknown) => value === null || typeof value === "string";
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const file = "PSI-25_Experimental table_BASS-II.csv";
const gasColumns = {
  o2: ["Calibrated initial O2 % by vol", "Calibrated final O2 % by vol"],
  co2: ["Initial CO2 % by vol", "Final CO2 % by vol"], co: ["Initial CO (ppm)", "Final CO (ppm)"],
};

export function parseBassIndex(value: unknown): BassIndex {
  const fail = (): never => { throw new Error("The BASS-II summary data has an unsupported, inconsistent or incomplete schema."); };
  if (!object(value) || value.schema_version !== 1 || value.investigation_id !== "PSI-25" || value.catalog_file !== file
      || !strings(value.catalog_columns) || !hash(value.catalog_sha256) || !hash(value.reviewed_source_sha256)
      || !Array.isArray(value.tests) || !object(value.coverage) || typeof value.method !== "string"
      || typeof value.source_snapshot !== "string" || !number(value.investigation_version)) return fail();
  const columns = value.catalog_columns;
  const guide = value.measurement_guide;
  if (!object(guide) || guide.key !== "readme" || guide.file_id !== "692480587f6aa6a830210602"
      || typeof guide.name !== "string" || typeof guide.locator !== "string" || typeof guide.role !== "string"
      || !hash(guide.sha256) || !number(guide.file_version) || typeof guide.url !== "string"
      || !guide.url.startsWith("https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?") || guide.download_url !== guide.url) return fail();
  if (!["PI", "Test #", "Sample #", "Date", ...Object.values(gasColumns).flat()].every((c) => columns.includes(c))) return fail();
  const ids = new Set<string>();
  for (const entry of value.tests) {
    if (!object(entry) || typeof entry.test_id !== "string" || !entry.test_id || ids.has(entry.test_id)
        || typeof entry.pi !== "string" || typeof entry.sample_id !== "string" || typeof entry.date !== "string"
        || !strings(entry.catalog_row) || entry.catalog_row.length !== columns.length || !number(entry.row_ordinal) || !Number.isInteger(entry.row_ordinal) || entry.row_ordinal < 1
        || typeof entry.summary !== "string" || !strings(entry.source_conflicts) || !strings(entry.limits)
        || !optionalText(entry.researcher_notes) || !optionalText(entry.interpretation) || entry.time_series !== null
        || !["catalog_only", "reported_results", "results_and_notes"].includes(String(entry.coverage))) return fail();
    const raw = entry.catalog_row;
    if (entry.test_id !== raw[columns.indexOf("Test #")] || entry.pi !== raw[columns.indexOf("PI")]
        || entry.sample_id !== raw[columns.indexOf("Sample #")] || entry.date !== raw[columns.indexOf("Date")]) return fail();
    if (!Array.isArray(entry.sources) || !entry.sources.length) return fail();
    const sources = new Set<string>();
    for (const s of entry.sources) {
      if (!object(s) || !["catalog", "table5_1", "notes"].includes(String(s.key)) || sources.has(String(s.key))
          || typeof s.name !== "string" || typeof s.role !== "string" || typeof s.locator !== "string" || !hash(s.sha256)
          || typeof s.file_id !== "string" || !number(s.file_version) || !Number.isInteger(s.file_version)
          || typeof s.download_url !== "string" || !s.download_url.startsWith("https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?")
          || typeof s.url !== "string") return fail();
      if (s.key === "catalog" ? s.file_id !== "67a3a17b09ed061032c19775" || s.sha256 !== value.catalog_sha256 || s.url !== s.download_url
        : s.file_id !== "6924805f7f6aa6a83021067c" || !/^https:\/\/ntrs\.nasa\.gov\/api\/citations\/20210011385\/downloads\/TM-20210011385\.pdf#page=\d+$/.test(s.url)) return fail();
      sources.add(String(s.key));
    }
    if (!sources.has("catalog") || !Array.isArray(entry.conditions)
        || !entry.conditions.every((c) => object(c) && typeof c.label === "string" && typeof c.value === "string" && c.source_key === "catalog")) return fail();
    if (!Array.isArray(entry.gas_readings) || entry.gas_readings.length !== 3) return fail();
    const gases = new Set<string>();
    for (const gas of entry.gas_readings) {
      if (!object(gas) || !["o2", "co2", "co"].includes(String(gas.key)) || gases.has(String(gas.key))
          || typeof gas.label !== "string" || gas.unit !== (gas.key === "co" ? "ppm" : "vol %") || gas.source_key !== "catalog") return fail();
      const names = gasColumns[gas.key as keyof typeof gasColumns];
      for (const [i, cell] of [gas.initial, gas.final].entries()) {
        if (!object(cell) || typeof cell.raw !== "string" || cell.raw !== raw[columns.indexOf(names[i])]
            || !optionalText(cell.issue) || cell.value !== null && (!number(cell.value) || cell.value < 0 || gas.key !== "co" && cell.value > 100
              || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.raw.trim()) || Number(cell.raw) !== cell.value)
            || (cell.value === null ? !cell.issue : cell.issue !== null)) return fail();
      }
      gases.add(String(gas.key));
    }
    const result = entry.reported_result;
    if (result !== null) {
      if (!object(result) || entry.pi !== "Miller" || !sources.has("table5_1") || result.source_key !== "table5_1"
          || !["thickness_mm", "width_cm", "burn_time_min"].every((k) => number(result[k]) && result[k] > 0)
          || ![1, 2].includes(Number(result.burning_sides)) || !Array.isArray(result.flow_spread_pairs) || !result.flow_spread_pairs.length
          || !["reported", "Not tracked"].includes(String(result.spread_status))) return fail();
      for (const pair of result.flow_spread_pairs) {
        if (!object(pair) || !number(pair.airflow_cm_s) || pair.airflow_cm_s < 0
            || (result.spread_status === "Not tracked" ? pair.spread_rate_mm_s !== null : !number(pair.spread_rate_mm_s) || pair.spread_rate_mm_s < 0)) return fail();
      }
    }
    if (entry.coverage !== (entry.researcher_notes !== null ? "results_and_notes" : result !== null ? "reported_results" : "catalog_only")
        || entry.researcher_notes !== null && (!result || !sources.has("notes"))
        || !Array.isArray(entry.derived_metrics) || !entry.derived_metrics.every((m) => object(m) && typeof m.key === "string"
          && typeof m.label === "string" && number(m.value) && typeof m.unit === "string" && typeof m.formula === "string"
          && strings(m.inputs) && sources.has(String(m.source_key)) && ["catalog", "table5_1"].includes(String(m.source_key)))) return fail();
    ids.add(entry.test_id);
  }
  const data = value as unknown as BassIndex;
  if (ids.size !== data.coverage.tests || data.tests.filter((t) => t.reported_result).length !== data.coverage.reported_results
      || data.tests.filter((t) => t.reported_result?.spread_status === "reported").length !== data.coverage.with_spread_rates
      || data.tests.filter((t) => t.researcher_notes !== null).length !== data.coverage.with_notes
      || data.tests.filter((t) => t.coverage === "catalog_only").length !== data.coverage.catalog_only) return fail();
  return data;
}

/** Full source-row and schema match prevents a stale summary attaching to a refreshed catalog. */
export function bassSummaryForRow(index: BassIndex, row: AnalyticsRow, table: ExperimentalTable): BassTestSummary | null {
  if (table.investigation_id !== index.investigation_id || table.file_name !== index.catalog_file
      || table.columns.length !== index.catalog_columns.length || !table.columns.every((v, i) => v === index.catalog_columns[i])) return null;
  return index.tests.find((entry) => entry.test_id === row.testId && entry.catalog_row.length === row.raw.length
    && entry.catalog_row.every((v, i) => v === row.raw[i])) ?? null;
}

export const bassAssetUrl = (path: string) => `${import.meta.env.BASE_URL}data/bass-ii/${path}`;
let indexRequest: Promise<BassIndex> | null = null;
export function loadBassSummaries(): Promise<BassIndex> {
  indexRequest ??= fetch(bassAssetUrl("summaries.json"), { headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load BASS-II summaries (HTTP ${response.status}).`);
    return parseBassIndex(await response.json());
  }).catch((error: unknown) => { indexRequest = null; throw error; });
  return indexRequest;
}
