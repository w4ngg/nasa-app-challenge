import type { ExperimentalTable } from "../types";
import { csvCell, validateAnalyticsTable } from "./analytics.ts";
import type { DatasetSpec } from "./analytics";

export interface ExperimentRecord {
  key: number;
  identifier: string;
  kind: "record" | "sample" | "flow reference" | "continuation";
  fields: Record<string, string>;
  raw: string[];
  warnings: string[];
  count: number | null;
}
export interface RecordFilters { search: string; material: string; category: string; flaggedOnly: boolean }
export const emptyRecordFilters: RecordFilters = { search: "", material: "", category: "", flaggedOnly: false };

export function readExperimentRecords(table: ExperimentalTable, spec: DatasetSpec): ExperimentRecord[] {
  if (spec.mode !== "source_records") throw new Error("This adapter requires a source-record profile.");
  validateAnalyticsTable(table, spec);
  const records = table.rows.map((raw, index): ExperimentRecord => {
    const fields = Object.fromEntries(table.columns.map((column, i) => [column, raw[i] ?? ""]));
    const get = (column: string) => fields[column]?.trim() ?? "";
    const identifier = spec.key === "bre" ? [get("Year"), get("Month"), get("Date")].join(" ").trim() : get(spec.idColumn);
    let kind: ExperimentRecord["kind"] = "record";
    const warnings: string[] = [];
    if (spec.recordKind === "samples") {
      if (/^S\d+$/.test(identifier)) kind = "sample";
      else if (/^F\d+C\d+/i.test(identifier)) kind = "flow reference";
      else throw new Error(`Unclassified sample/reference at source row ${index + 1}.`);
      if (kind === "sample") warnings.push("Geometry and thickness are preserved in source units; verify dimensions against the experiment report before conversion.");
    }
    if (spec.key === "bre" && /(?:3400|2100)%/.test(get("Oxygen Conc (percent)"))) warnings.push("Source oxygen exceeds 100%; it has not been corrected or used as an exact oxygen measurement.");
    if (spec.key === "cld-flame" && /\b(?:CH(?!4\b)\d+|C2H(?!4\b)\d+)\b/.test(get("Fuel Bottle"))) warnings.push("Fuel formula is part of an inconsistent source sequence; chemical identity requires verification.");
    if (spec.key === "s-flame" && /\bN[3-6]\b/.test(`${get("Fuel Bottle")} ${get("Atmosphere*")}`)) warnings.push("Source N3–N6 labels require verification; they have not been replaced with N2.");
    if (spec.key === "e-field" && !get("Test Day")) {
      kind = "continuation";
      warnings.push("Continuation record: missing date, fuel, polarity and counts are not inherited from neighbouring rows.");
    }
    if (spec.key === "same" && /same conditions/i.test(raw.join(" "))) warnings.push("This row refers to conditions 1–4; no synthetic test rows or numeric values have been generated.");
    if (spec.key === "slice" && /calibrat|SPICE/i.test(raw.join(" "))) warnings.push("Description includes calibration or SPICE context; do not count it as a single SLICE flame test.");
    const countText = spec.countColumn ? get(spec.countColumn) : "";
    const count = /^\d+$/.test(countText) && Number.isSafeInteger(Number(countText)) ? Number(countText) : null;
    if (spec.countColumn && count === null) warnings.push("Ignited-flame count is missing or non-integer; it has not been set to zero.");
    return { key: index + 1, identifier: identifier || `Unlabelled row ${index + 1}`, kind, fields, raw, warnings, count };
  });
  const ids = new Map<string, number>();
  records.forEach((row) => ids.set(row.identifier, (ids.get(row.identifier) ?? 0) + 1));
  records.forEach((row) => {
    if (ids.get(row.identifier)! > 1) row.warnings.push("Source identifier is repeated; use the data-row ordinal to distinguish records.");
  });
  return records;
}

export function filterExperimentRecords(rows: ExperimentRecord[], filters: RecordFilters, spec: DatasetSpec): ExperimentRecord[] {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => (!query || row.raw.some((cell) => cell.toLowerCase().includes(query)))
    && (!filters.material || (row.fields[spec.materialColumn]?.trim() || "Not recorded") === filters.material)
    && (!filters.category || (row.fields[spec.categories[0]?.column]?.trim() || "Not recorded") === filters.category)
    && (!filters.flaggedOnly || row.warnings.length > 0));
}

/** Only DOI links from the publication-index column are made interactive. */
export function publicationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !["doi.org", "dx.doi.org"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return `https://doi.org${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}

export function experimentRecordsCsv({ rows, allRows, table, spec, sourceUrl, filters }: {
  rows: ExperimentRecord[]; allRows: ExperimentRecord[]; table: ExperimentalTable; spec: DatasetSpec; sourceUrl: string; filters: RecordFilters;
}): string {
  const notes = allRows.filter((row) => row.fields.Notes?.trim()).map((row) => ({ data_row_ordinal: row.key, text: row.fields.Notes }));
  const references = allRows.filter((row) => row.kind === "flow reference").map((row) => ({ data_row_ordinal: row.key, fields: row.fields }));
  const header = ["investigation_id", "source_file", "source_url", "data_row_ordinal", "record_kind", "record_identifier", "table_kind", "filters_json", "review_flags", "interpretation_limits", "source_notes_json", "flow_references_json", ...table.columns.map((c) => `raw: ${c}`)];
  const body = rows.map((row) => [spec.id, table.file_name, sourceUrl, String(row.key), row.kind, row.identifier, spec.recordKind ?? "", JSON.stringify(filters), row.warnings.join("\n"), spec.limits, JSON.stringify(notes), JSON.stringify(references), ...row.raw]);
  return "\uFEFF" + [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
