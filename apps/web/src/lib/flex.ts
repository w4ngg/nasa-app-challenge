import type { AnalyticsRow } from "./analytics";
import type { ExperimentalTable } from "../types";

export interface FlexSource {
  role: string; name: string; url: string; file_id: string;
  file_version: number; sha256: string; row_ordinal?: number;
}

export interface FlexTestSummary {
  test_id: string; name: string; cir_id: string; row_ordinal: number;
  source_test_id: string | null; source_match_basis: string; source_conflicts: string[];
  catalog_row: string[];
  coverage: "series_and_notes" | "series" | "notes" | "catalog_only";
  summary: string; conditions: { label: string; value: string }[];
  recorded_outcome: { test_end: string; burn_time_s: number | null; extinction_diameter_mm: number | null };
  researcher_excerpt: string | null; researcher_notes: string | null;
  limits: string[]; sources: FlexSource[]; history_path: string | null;
  series_counts: Record<string, number>;
}

export interface FlexIndex {
  schema_version: number; investigation_id: "PSI-69"; investigation_version: number;
  source_snapshot: string; catalog_file: string; catalog_sha256: string; method: string;
  context_publications: { title: string; url: string; role: string }[];
  coverage: { tests: number; test_sheets: number; with_history: number; catalog_only: number };
  tests: FlexTestSummary[];
}

export interface FlexSeries {
  points: [number, number | null][];
  time_column: string; value_column: string; source_role: string;
  source_file_id: string; source_sha256: string;
  count: number; invalid_count: number; gaps: number; gap_limit_s?: number;
  range_s: [number, number] | null; error: string | null;
}

export interface FlexFit {
  window_s: [number, number]; points: number; k_mm2_s: number;
  intercept_mm2: number; r_squared: number | null; source_role: string; label: string;
}

export interface FlexHistory {
  schema_version: number; investigation_id: "PSI-69"; test_id: string; cir_id: string;
  time_origin: string; recorded_endpoint_s: number | null; display_end_s: number | null;
  series: Partial<Record<"droplet" | "lluv" | "color", FlexSeries>>; fits: FlexFit[];
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalText = (value: unknown) => value === null || typeof value === "string";
const nullableNumber = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);

export function parseFlexIndex(value: unknown): FlexIndex {
  const fail = () => { throw new Error("The FLEX summary dataset has an unsupported or incomplete schema."); };
  if (!object(value) || value.schema_version !== 1 || value.investigation_id !== "PSI-69"
      || value.catalog_file !== "PSI-69_Experimental table_FLEX.csv" || !Array.isArray(value.tests)
      || !Array.isArray(value.context_publications) || !object(value.coverage)) return fail();
  const ids = new Set<string>();
  for (const entry of value.tests) {
    if (!object(entry) || typeof entry.test_id !== "string" || !/^\d+$/.test(entry.test_id)
        || ids.has(entry.test_id) || !optionalText(entry.source_test_id)
        || entry.name !== (typeof entry.source_test_id === "string" ? `FLEX-${entry.source_test_id.padStart(3, "0")}` : `Catalog test ${entry.test_id}`)
        || typeof entry.source_match_basis !== "string" || !strings(entry.source_conflicts)
        || typeof entry.cir_id !== "string" || !strings(entry.catalog_row)
        || typeof entry.summary !== "string" || !Array.isArray(entry.conditions)
        || !entry.conditions.every((c) => object(c) && typeof c.label === "string" && typeof c.value === "string")
        || !strings(entry.limits) || !optionalText(entry.researcher_excerpt) || !optionalText(entry.researcher_notes)
        || !Array.isArray(entry.sources) || !entry.sources.every((s) => object(s) && typeof s.role === "string"
          && typeof s.name === "string" && typeof s.url === "string" && s.url.startsWith("https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?"))
        || !object(entry.recorded_outcome) || !nullableNumber(entry.recorded_outcome.burn_time_s)
        || !nullableNumber(entry.recorded_outcome.extinction_diameter_mm)
        || !["series_and_notes", "series", "notes", "catalog_only"].includes(String(entry.coverage))
        || entry.history_path !== null && entry.history_path !== `history/${entry.test_id}.json`) return fail();
    ids.add(entry.test_id);
  }
  if (ids.size !== value.coverage.tests) return fail();
  return value as unknown as FlexIndex;
}

/** Match the complete original row, not its ordinal or a coincidentally equal test number. */
export function summaryForRow(index: FlexIndex, row: AnalyticsRow, table: ExperimentalTable): FlexTestSummary | null {
  if (table.investigation_id !== index.investigation_id || table.file_name !== index.catalog_file) return null;
  const entry = index.tests.find((t) => t.test_id === row.testId);
  const cirColumn = table.columns.indexOf("FLEX Identifier");
  if (!entry || cirColumn < 0 || entry.cir_id !== row.raw[cirColumn]
      || entry.catalog_row.length !== row.raw.length || !entry.catalog_row.every((v, i) => v === row.raw[i])) return null;
  return entry;
}

export function parseFlexHistory(value: unknown, test: FlexTestSummary): FlexHistory {
  if (!object(value) || value.schema_version !== 1 || value.investigation_id !== "PSI-69"
      || value.test_id !== test.test_id || value.cir_id !== test.cir_id || !object(value.series)
      || !Array.isArray(value.fits) || !nullableNumber(value.recorded_endpoint_s) || !nullableNumber(value.display_end_s)) {
    throw new Error("This time history does not match the selected FLEX test.");
  }
  for (const series of Object.values(value.series)) {
    if (!object(series) || !Array.isArray(series.points) || !series.points.every((p) => Array.isArray(p)
        && p.length === 2 && typeof p[0] === "number" && Number.isFinite(p[0]) && nullableNumber(p[1]))
        || typeof series.source_role !== "string" || !test.sources.some((s) => s.role === series.source_role
          && s.file_id === series.source_file_id && s.sha256 === series.source_sha256)) throw new Error("Invalid FLEX time-history measurements or source identity.");
  }
  return value as unknown as FlexHistory;
}

/** Break at source gaps/reversed timestamps; never interpolate an unavailable reading. */
export function historySegments(series: FlexSeries, end: number | null = null): [number, number][][] {
  const segments: [number, number][][] = [];
  let segment: [number, number][] = [];
  for (const [t, d] of series.points) {
    if (t < 0 || end !== null && t > end || d === null) {
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    const previous = segment.at(-1);
    if (previous && (t <= previous[0] || t - previous[0] > (series.gap_limit_s ?? .25))) {
      segments.push(segment); segment = [];
    }
    segment.push([t, d]);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export const flexAssetUrl = (path: string) => `${import.meta.env.BASE_URL}data/flex/${path}`;
let indexRequest: Promise<FlexIndex> | null = null;
const histories = new Map<string, Promise<FlexHistory>>();

async function json(path: string): Promise<unknown> {
  const response = await fetch(flexAssetUrl(path), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not load the FLEX summary data (HTTP ${response.status}).`);
  return response.json();
}

export function loadFlexSummaries(): Promise<FlexIndex> {
  indexRequest ??= json("summaries.json").then(parseFlexIndex).catch((error: unknown) => { indexRequest = null; throw error; });
  return indexRequest;
}

export function loadFlexHistory(test: FlexTestSummary): Promise<FlexHistory> {
  if (!test.history_path) return Promise.reject(new Error("No time history is available for this test."));
  const key = `${test.test_id}/${test.cir_id}`;
  if (!histories.has(key)) {
    histories.set(key, json(test.history_path).then((value) => parseFlexHistory(value, test))
      .catch((error: unknown) => { histories.delete(key); throw error; }));
  }
  return histories.get(key)!;
}
