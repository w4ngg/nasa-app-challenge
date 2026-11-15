import type { ExperimentalTable } from "../types";
import { csvCell } from "./analytics.ts";

export const saffireFields = [
  "Material", "Samle Thickness", "Sample Length", "Sample Width (cm)", "Air Flow (cm/s)",
  "Percent O2 (Note 1)", "Ignition Power (W)", "Ignition Time (s)", "Burn Time (s)",
  "Flow Direction", "?-g Burn Length", "?-g Spread Length", "1-g Burn Length", "1-g Spread Rate",
];

export interface SaffireRow {
  key: number;
  sampleId: string;
  fields: Record<string, string>;
  raw: string[];
  warnings: string[];
}
export interface SaffireData {
  samples: SaffireRow[];
  references: SaffireRow[];
  notes: SaffireRow[];
}

export function readSaffire(table: ExperimentalTable): SaffireData {
  if (table.investigation_id !== "PSI-99" || table.file_name !== "PSI-99_Experimental table_SAFFIRE-2.csv") throw new Error("Unexpected SAFFIRE-II source.");
  const missing = ["Sample Number", ...saffireFields].filter((c) => !table.columns.includes(c));
  if (missing.length) throw new Error(`The SAFFIRE-II schema changed. Missing columns: ${missing.join(", ")}`);
  const result: SaffireData = { samples: [], references: [], notes: [] };
  table.rows.forEach((raw, index) => {
    const fields = Object.fromEntries(table.columns.map((column, i) => [column, raw[i] ?? ""]));
    const sampleId = fields["Sample Number"].trim();
    const row: SaffireRow = { key: index + 1, sampleId, fields, raw, warnings: [] };
    if (/^2-\d+$/.test(sampleId)) {
      if (!fields.Material.trim()) row.warnings.push("Material is blank in the source; no neighbouring material has been copied.");
      if (/^0\d+\s*mm$/i.test(fields["Samle Thickness"].trim())) row.warnings.push(`Thickness ‘${fields["Samle Thickness"]}’ is ambiguous and has not been converted to a number.`);
      if (/see|and/i.test(fields["Samle Thickness"])) row.warnings.push("Thickness refers to a figure or multiple sample components.");
      if (/mm\/s/i.test(fields["?-g Spread Length"])) row.warnings.push("The source heading says ‘Spread Length’ but this cell uses mm/s. Its meaning needs verification before numeric analysis.");
      if (/insignificant/i.test(fields["Burn Time (s)"])) row.warnings.push("‘Insignificant’ is a reported description, not a zero-second measurement.");
      result.samples.push(row);
    } else if (/^F\d+C\d+/i.test(sampleId)) result.references.push(row);
    else if (/^Note\s+\d+/i.test(sampleId)) result.notes.push(row);
    else throw new Error(`Unclassified SAFFIRE-II row ${index + 1}; review the source before showing samples.`);
  });
  return result;
}

export function saffireCsv({ rows, data, table, sourceUrl, material, direction }: {
  rows: SaffireRow[]; data: SaffireData; table: ExperimentalTable; sourceUrl: string; material: string; direction: string;
}): string {
  const header = ["investigation_id", "source_file", "source_url", "data_row_ordinal", "record_kind", "filters_json", "review_flags", "source_notes",
    ...table.columns.map((column) => `raw: ${column}`)];
  const body = rows.map((row) => ["PSI-99", table.file_name, sourceUrl, String(row.key), "sample", JSON.stringify({ material, direction }),
    row.warnings.join("\n"), data.notes.map((note) => note.sampleId).join("\n"), ...table.columns.map((_, i) => row.raw[i] ?? "")]);
  return "\uFEFF" + [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
