import { useMemo, useState } from "react";
import type { DatasetSpec } from "../lib/analytics";
import {
  emptyRecordFilters, experimentRecordsCsv, filterExperimentRecords, publicationUrl, readExperimentRecords,
} from "../lib/experiment-records";
import type { ExperimentRecord, RecordFilters } from "../lib/experiment-records";
import { viewUrl } from "../lib/route";
import type { InvestigationDetail } from "../types";

const kindLabels = { samples: "Sample records", coverage: "Condition coverage", daily: "Daily summaries", inventory: "Source inventory", publications: "Data and publication index" };
const pageSize = 25;

function SourceValue({ column, value }: { column: string; value: string }) {
  const href = column === "Reference Publication Link" ? publicationUrl(value) : null;
  return href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : <>{value || <span className="muted">Empty source cell</span>}</>;
}

export function ExperimentRecords({ detail, spec }: { detail: InvestigationDetail; spec: DatasetSpec }) {
  const table = detail.tables.find((t) => t.file_name === spec.file)!;
  const allRows = useMemo(() => readExperimentRecords(table, spec), [table, spec]);
  const records = useMemo(() => allRows.filter((r) => r.kind !== "flow reference"), [allRows]);
  const references = allRows.filter((r) => r.kind === "flow reference");
  const notes = allRows.filter((r) => r.fields.Notes?.trim());
  const [filters, setFilters] = useState<RecordFilters>({ ...emptyRecordFilters });
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [comparedKeys, setComparedKeys] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => filterExperimentRecords(records, filters, spec), [records, filters, spec]);
  const selected = filtered.find((r) => r.key === selectedKey);
  const compared = filtered.filter((r) => comparedKeys.includes(r.key));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const columns = (spec.displayColumns ?? table.columns).filter((c) => c !== spec.idColumn);
  const materialOf = (row: ExperimentRecord) => row.fields[spec.materialColumn]?.trim() || "Not recorded";
  const materials = [...new Set(records.map(materialOf))].sort();
  const category = spec.categories[0];
  const categoryValues = category ? [...new Set(records.map((r) => r.fields[category.column].trim() || "Not recorded"))].sort() : [];
  const counted = filtered.filter((r) => r.count !== null);
  const maxCount = Math.max(1, ...counted.map((r) => r.count!));
  const change = (patch: Partial<RecordFilters>) => {
    setFilters((f) => ({ ...f, ...patch })); setPage(0); setSelectedKey(null); setComparedKeys([]); setNotice("");
  };
  const select = (row: ExperimentRecord) => { setSelectedKey(row.key); setPage(Math.floor(filtered.indexOf(row) / pageSize)); };
  const exportCsv = () => {
    const csv = experimentRecordsCsv({ rows: filtered, allRows, table, spec, sourceUrl: detail.investigation.source_url, filters });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${spec.key}-filtered-records.csv`;
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${filtered.length} records with original cells, review flags, source notes and provenance.`);
  };
  return <>
    <section className="panel" aria-labelledby="record-filters">
      <div className="analytics-section-head"><h2 id="record-filters">2. Find source records</h2><button className="link-button" onClick={() => change({ ...emptyRecordFilters })}>Reset filters</button></div>
      <div className="analytics-filter-grid">
        <label className="analytics-field">Search all source fields<input type="search" value={filters.search} placeholder="Material, identifier, date or source note" onChange={(e) => change({ search: e.target.value })} /></label>
        <label className="analytics-field">Source material / description<select value={filters.material} onChange={(e) => change({ material: e.target.value })}><option value="">All source descriptions</option>{materials.map((m) => <option key={m}>{m}</option>)}</select></label>
        {category && <label className="analytics-field">{category.label}<select value={filters.category} onChange={(e) => change({ category: e.target.value })}><option value="">All recorded values</option>{categoryValues.map((v) => <option key={v}>{v}</option>)}</select></label>}
        <label className="analytics-record-check"><input type="checkbox" checked={filters.flaggedOnly} onChange={(e) => change({ flaggedOnly: e.target.checked })} />Only records with review flags</label>
      </div>
      <p className="analytics-counts" role="status"><strong>{filtered.length}</strong> matching records · {records.length} primary source records · {references.length} flow references · {allRows.length} total source rows</p>
      <p className="field-help">Search matches text within an original source cell. Empty cells stay empty; ranges, lists and references retain their source meaning.</p>
    </section>

    <section className="panel panel-focus" aria-labelledby="record-results">
      <div className="analytics-section-head"><h2 id="record-results">3. {kindLabels[spec.recordKind!]}</h2><button disabled={!filtered.length} onClick={exportCsv}>Export filtered CSV ({filtered.length})</button></div>
      <p className="panel-lede">{spec.limits}</p>
      {table.note && <p className="analytics-quality">{table.note}</p>}
      {spec.countColumn && <figure className="analytics-record-counts">
        <figcaption>Recorded ignited flames per source record · {counted.length} numeric counts · {filtered.length - counted.length} missing/non-integer counts</figcaption>
        <p className="field-help">Counts describe the listed day or record. Attempt totals are absent, so these values do not represent ignition probabilities. Select a bar to inspect the source record.</p>
        <ol>{counted.map((row) => <li key={row.key}><button onClick={() => select(row)} aria-pressed={selectedKey === row.key} aria-label={`Inspect record ${row.identifier}, data row ${row.key}, ${row.count} ignited flames`}>
          <span>{row.identifier}<small>Data row {row.key}</small></span><span className="analytics-count-track" aria-hidden="true"><span style={{ width: `${row.count! / maxCount * 100}%` }} /></span><strong>{row.count}</strong>
        </button></li>)}</ol>
        {!counted.length && <p className="analytics-source-prompt">No numeric counts match these filters. Source records remain available below.</p>}
      </figure>}
      {notice && <p className="analytics-notice" role="status">{notice}</p>}
      <p className="field-help">Select up to three records to compare every original field. Source-row counts are not counts of independent experiments.</p>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Filtered source records"><table className="analytics-table analytics-record-table">
        <caption className="sr-only">{kindLabels[spec.recordKind!]} with unchanged source cells and review flags.</caption>
        <thead><tr><th scope="col">Compare</th><th scope="col">Record / data row</th>{columns.map((c) => <th scope="col" key={c}>{c}</th>)}<th scope="col">Review</th></tr></thead>
        <tbody>{shown.map((row) => <tr key={row.key} className={selectedKey === row.key ? "analytics-row-selected" : undefined}>
          <td><input type="checkbox" aria-label={`Compare data row ${row.key}`} checked={comparedKeys.includes(row.key)} disabled={comparedKeys.length >= 3 && !comparedKeys.includes(row.key)} onChange={() => setComparedKeys((keys) => keys.includes(row.key) ? keys.filter((k) => k !== row.key) : [...keys, row.key])} /></td>
          <th scope="row"><button className="link-button" aria-pressed={selectedKey === row.key} onClick={() => select(row)}>{row.identifier}</button><small>Data row {row.key} · {row.kind}</small></th>
          {columns.map((c) => <td key={c}><SourceValue column={c} value={row.fields[c]} /></td>)}
          <td>{row.warnings.length ? <button className="link-button" onClick={() => select(row)}>{row.warnings.length} review {row.warnings.length === 1 ? "flag" : "flags"}</button> : "See source limits"}</td>
        </tr>)}{!shown.length && <tr><td colSpan={columns.length + 3}>No source records match these filters.</td></tr>}</tbody>
      </table></div>
      <div className="pagination"><span>{filtered.length ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}` : "0 records"}</span><div><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button><span>Page {safePage + 1} of {pageCount}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button></div></div>
      {selected && <p className="analytics-notice">Data row {selected.key} is selected. <a href="#record-source">Inspect its original fields and review flags</a>.</p>}
      {compared.length > 0 && <div className="analytics-comparison">
        <div className="analytics-section-head"><h3>Selected records ({compared.length}/3)</h3><button className="link-button" onClick={() => setComparedKeys([])}>Clear comparison</button></div>
        <p className="analytics-quality">Descriptive source comparison. These records do not establish matched conditions, independent replicates or a causal effect.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Selected source record comparison"><table className="analytics-record-table"><thead><tr><th scope="col">Source field</th>{compared.map((r) => <th scope="col" key={r.key}>{r.identifier} · row {r.key}</th>)}</tr></thead><tbody>
          {table.columns.map((c) => <tr key={c}><th scope="row">{c}</th>{compared.map((r) => <td key={r.key}><SourceValue column={c} value={r.fields[c]} /></td>)}</tr>)}
          <tr><th scope="row">Review flags</th>{compared.map((r) => <td key={r.key}>{r.warnings.join(" ") || "See source limits."}</td>)}</tr>
        </tbody></table></div>
      </div>}
    </section>

    <section className="panel analytics-source" id="record-source" aria-labelledby="record-source-heading">
      <h2 id="record-source-heading">4. Check the source and its notes</h2>
      <p className="sources">Source: <a href={detail.investigation.source_url} target="_blank" rel="noreferrer">NASA PSI · {spec.id}</a> · {table.file_name}. Ordinals count data rows after the exported header. <a href={`${viewUrl("lab")}&id=${spec.id}`} target="_blank" rel="noreferrer">Open investigation details (new tab)</a>.</p>
      {notes.length > 0 && <details className="analytics-method"><summary>Shared source notes ({notes.length})</summary><ul>{notes.map((r) => <li key={r.key}>Data row {r.key}: {r.fields.Notes}</li>)}</ul></details>}
      {selected ? <>
        <div className="analytics-section-head"><h3>Source row {selected.key} · {selected.identifier}</h3><button className="link-button" onClick={() => setSelectedKey(null)}>Close row</button></div>
        {selected.warnings.length > 0 && <ul className="analytics-comparison-notes">{selected.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <dl className="analytics-raw-fields">{table.columns.map((column) => <div key={column}><dt>{column}</dt><dd><SourceValue column={column} value={selected.fields[column]} /></dd></div>)}</dl>
      </> : <p className="analytics-source-prompt">Select a record to inspect all its original fields and review flags.</p>}
      {references.length > 0 && <details className="analytics-method"><summary>Pre-test flow references ({references.length})</summary>{references.map((r) => <div key={r.key}><h3>{r.identifier} · data row {r.key}</h3><dl className="analytics-raw-fields">{table.columns.map((c) => <div key={c}><dt>{c}</dt><dd><SourceValue column={c} value={r.fields[c]} /></dd></div>)}</dl></div>)}</details>}
      <p className="field-help">CSV exports include filtered records, source-row ordinals, interpretation limits, review flags and shared notes/references. Text that could become a spreadsheet formula receives an apostrophe prefix.</p>
    </section>
  </>;
}
