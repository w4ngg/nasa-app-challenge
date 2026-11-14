import { useMemo, useState } from "react";
import { readSaffire, saffireCsv, saffireFields } from "../lib/saffire";
import { viewUrl } from "../lib/route";
import type { DatasetSpec } from "../lib/analytics";
import type { InvestigationDetail } from "../types";

export function SaffireSamples({ detail, spec }: { detail: InvestigationDetail; spec: DatasetSpec }) {
  const table = detail.tables.find((t) => t.file_name === spec.file)!;
  const data = useMemo(() => readSaffire(table), [table]);
  const [material, setMaterial] = useState("");
  const [direction, setDirection] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [comparedKeys, setComparedKeys] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const materialOf = (row: (typeof data.samples)[number]) => row.fields.Material.trim() || "Not recorded";
  const materials = [...new Set(data.samples.map(materialOf))].sort();
  const directions = [...new Set(data.samples.map((r) => r.fields["Flow Direction"]))].sort();
  const filtered = data.samples.filter((r) => (!material || materialOf(r) === material) && (!direction || r.fields["Flow Direction"] === direction));
  const inspected = filtered.find((r) => r.key === selected);
  const compared = filtered.filter((r) => comparedKeys.includes(r.key));
  const clearSelection = () => { setSelected(null); setComparedKeys([]); setNotice(""); };
  const exportCsv = () => {
    const csv = saffireCsv({ rows: filtered, data, table, sourceUrl: detail.investigation.source_url, material, direction });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "saffire-ii-filtered-samples.csv";
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${filtered.length} sample rows with original cells, review flags, filters, source links and ${data.notes.length} source notes.`);
  };
  return <>
    <section className="panel" aria-labelledby="saffire-conditions">
      <div className="analytics-section-head"><h2 id="saffire-conditions">2. Select the sample conditions</h2><button className="link-button" onClick={() => { setMaterial(""); setDirection(""); clearSelection(); }}>Reset filters</button></div>
      <div className="analytics-filter-grid">
        <label className="analytics-field">Material description (source)<select value={material} onChange={(e) => { setMaterial(e.target.value); clearSelection(); }}><option value="">All recorded materials</option>{materials.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="analytics-field">Flow direction<select value={direction} onChange={(e) => { setDirection(e.target.value); clearSelection(); }}><option value="">All flow directions</option>{directions.map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <p className="analytics-counts" role="status"><strong>{filtered.length}</strong> matching sample records · {data.samples.length} source samples · {data.references.length} flow references · {data.notes.length} source notes</p>
      <p className="field-help">Oxygen is approximate or a range and is derived as explained in source note 1. Original thickness, airflow and oxygen strings are available in the comparison and source row.</p>
    </section>

    <section className="panel panel-focus" aria-labelledby="saffire-results">
      <div className="analytics-section-head"><h2 id="saffire-results">3. Compare the reported sample outcomes</h2><button disabled={!filtered.length} onClick={exportCsv}>Export filtered CSV ({filtered.length})</button></div>
      <p className="panel-lede">{spec.limits}</p>
      <p className="analytics-quality">Values remain in their original text and units. ‘Insignificant’, ‘Complete’, ‘Acceleratory’, approximate values and note references are not converted to scalar measurements.</p>
      {notice && <p className="analytics-notice" role="status">{notice}</p>}
      <div className="table-scroll" tabIndex={0} role="region" aria-label="SAFFIRE-II sample outcomes"><table className="analytics-table">
        <caption className="sr-only">Nine sample records, kept separate from flow references and source notes.</caption>
        <thead><tr><th scope="col">Compare</th><th scope="col">Sample / data row</th><th scope="col">Material (source)</th><th scope="col">Thickness (source)</th><th scope="col">Flow direction</th><th scope="col">Burn time (source)</th><th scope="col">Review</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.key} className={selected === row.key ? "analytics-row-selected" : undefined}>
          <td><input type="checkbox" checked={comparedKeys.includes(row.key)} disabled={comparedKeys.length >= 3 && !comparedKeys.includes(row.key)} aria-label={`Compare sample ${row.sampleId}`} onChange={() => setComparedKeys((keys) => keys.includes(row.key) ? keys.filter((k) => k !== row.key) : [...keys, row.key])} /></td>
          <th scope="row"><button className="link-button" aria-pressed={selected === row.key} onClick={() => setSelected(row.key)}>Sample {row.sampleId}</button><small>Data row {row.key}</small></th>
          <td>{materialOf(row)}</td><td>{row.fields["Samle Thickness"]}</td><td>{row.fields["Flow Direction"]}</td><td>{row.fields["Burn Time (s)"]}</td><td>{row.warnings.length ? `${row.warnings.length} review ${row.warnings.length === 1 ? "flag" : "flags"}` : "See source notes"}</td>
        </tr>)}{!filtered.length && <tr><td colSpan={7}>No sample records match these filters.</td></tr>}</tbody>
      </table></div>
      {inspected && <p className="analytics-notice">Sample {inspected.sampleId} is selected. <a href="#saffire-source">Inspect its complete source row and review flags</a>.</p>}
      {compared.length > 0 && <div className="analytics-comparison">
        <div className="analytics-section-head"><h3>Selected samples ({compared.length}/3)</h3><button className="link-button" onClick={() => setComparedKeys([])}>Clear comparison</button></div>
        {compared.length < 2 ? <p className="field-help">Select another sample to compare its source-reported conditions and outcomes.</p> : <>
          <p className="analytics-quality">Sample geometry, material, ignition settings and flow direction may differ. The 1-g columns are source-listed reference results; the table does not establish identical conditions or paired replicates.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="SAFFIRE-II selected sample comparison"><table>
            <thead><tr><th scope="col">Source field</th>{compared.map((r) => <th scope="col" key={r.key}>Sample {r.sampleId}</th>)}</tr></thead>
            <tbody>{saffireFields.map((field) => <tr key={field}><th scope="row">{field}</th>{compared.map((r) => <td key={r.key} title={r.fields[field]}>{r.fields[field] || "Empty source cell"}</td>)}</tr>)}
              <tr><th scope="row">Review flags</th>{compared.map((r) => <td key={r.key} className="saffire-long-cell">{r.warnings.join(" ") || "See the shared source notes."}</td>)}</tr>
            </tbody>
          </table></div>
        </>}
      </div>}
    </section>

    <section className="panel analytics-source" id="saffire-source" aria-labelledby="saffire-source-heading">
      <h2 id="saffire-source-heading">4. Check the source and its notes</h2>
      <p className="sources">Source: <a href={detail.investigation.source_url} target="_blank" rel="noreferrer">NASA PSI · PSI-99</a> · {table.file_name}. Data-row ordinals count rows in the exported table after its header. <a href={`${viewUrl("lab")}&id=PSI-99`} target="_blank" rel="noreferrer">Open investigation details (new tab)</a>.</p>
      <ul className="analytics-comparison-notes">{data.notes.map((note) => <li key={note.key}>{note.sampleId}</li>)}</ul>
      {inspected ? <>
        <div className="analytics-section-head"><h3>Source row {inspected.key} · Sample {inspected.sampleId}</h3><button className="link-button" onClick={() => setSelected(null)}>Close row</button></div>
        {inspected.warnings.length > 0 && <ul className="analytics-comparison-notes">{inspected.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <dl className="analytics-raw-fields">{table.columns.map((column, i) => <div key={column}><dt>{column}</dt><dd>{inspected.raw[i] || "Empty source cell"}</dd></div>)}</dl>
      </> : <p className="analytics-source-prompt">Select a sample to inspect every original field and its review flags.</p>}
      <details className="analytics-method"><summary>Pre-test flow references ({data.references.length})</summary><ul>{data.references.map((r) => <li key={r.key}>{r.sampleId} · {r.fields.Material} · data row {r.key}</li>)}</ul></details>
    </section>
  </>;
}
