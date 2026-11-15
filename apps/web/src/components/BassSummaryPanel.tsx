import { useEffect, useRef } from "react";
import { displayNumber } from "../lib/analytics";
import type { BassIndex, BassTestSummary } from "../lib/bass";
import { BassFlowEvidence, BassGasEvidence } from "./BassEvidence";

const coverageLabel = { catalog_only: "Catalog readings · report outcomes not yet reviewed", reported_results: "Catalog readings and reported results", results_and_notes: "Catalog readings, reported results and reviewed NASA notes" };

export function BassSummaryPanel({ testId, entry, index, error, onClose, onRetry }: {
  testId: string; entry: BassTestSummary | null; index: BassIndex | null; error: string;
  onClose: () => void; onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="flex-summary-panel bass-summary-panel" aria-labelledby="bass-summary-title" onClose={onClose}
    onClick={(event) => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current.close(); } }}>
    <header className="flex-summary-header"><div><p className="eyebrow">PSI-25 · Experiment summary</p><h2 id="bass-summary-title">BASS-II · {testId}</h2>{entry && <p>{entry.pi} · Sample {entry.sample_id || "not recorded"} · {entry.date}<br />{coverageLabel[entry.coverage]}</p>}</div><button autoFocus onClick={() => dialog.current?.close()} aria-label="Close BASS-II experiment summary">Close</button></header>
    {error ? <div className="state" role="alert"><h3>Could not load the BASS-II summary</h3><p>{error}</p><button onClick={onRetry}>Try again</button></div>
      : !index ? <p className="state" role="status">Loading the BASS-II experiment summary…</p>
        : !entry ? <div className="state" role="alert"><h3>Summary unavailable for this source row</h3><p>The investigator, test, sample, date and complete source row must match the reviewed catalog snapshot. No other test’s evidence is substituted.</p></div>
          : <SummaryContent key={`${entry.pi}/${entry.test_id}/${entry.sample_id}/${entry.date}`} entry={entry} index={index} />}
  </dialog>;
}

function SummaryContent({ entry, index }: { entry: BassTestSummary; index: BassIndex }) {
  const source = (key: string) => entry.sources.find((s) => s.key === key);
  const result = entry.reported_result;
  const download = () => {
    const data = { schema_version: index.schema_version, investigation_id: index.investigation_id, investigation_version: index.investigation_version,
      source_snapshot: index.source_snapshot, catalog_file: index.catalog_file, catalog_sha256: index.catalog_sha256,
      catalog_columns: index.catalog_columns, reviewed_source_sha256: index.reviewed_source_sha256, method: index.method,
      measurement_guide: index.measurement_guide, ...entry };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `BASS-II-${entry.test_id}-summary.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="flex-summary-body">
    {entry.source_conflicts.length > 0 && <section className="flex-source-conflicts"><h3>Source values need review</h3><ul>{entry.source_conflicts.map((c) => <li key={c}>{c}</li>)}</ul></section>}
    <section><h3>What is recorded for this test?</h3><p className="flex-summary-lede">{entry.summary}</p><p className="field-help">Prepared from catalog data and reviewed report text. No image or video analysis, inferred mechanism or predictive model is included.</p></section>
    <section><h3>Recorded conditions</h3><dl className="flex-conditions">{entry.conditions.map((c) => <div key={c.label}><dt>{c.label}</dt><dd>{c.value}</dd></div>)}</dl><p className="field-help"><a href={source("catalog")?.url} target="_blank" rel="noreferrer">Experimental table · data row {entry.row_ordinal}</a>. Source sequences are kept as text.</p></section>
    <section><h3>Reported experimental results</h3>{result ? <>
      <dl className="flex-conditions"><div><dt>Thickness (report)</dt><dd>{result.thickness_mm} mm</dd></div><div><dt>Width (report)</dt><dd>{result.width_cm} cm</dd></div><div><dt>Burning sides (report)</dt><dd>{result.burning_sides}</dd></div><div><dt>Burn time (report)</dt><dd>{result.burn_time_min} min</dd></div></dl>
      <p className="field-help"><a href={source("table5_1")?.url} target="_blank" rel="noreferrer">{source("table5_1")?.locator}</a>. Reported geometry is shown alongside the original catalog description.</p>
      <BassFlowEvidence result={result} testId={entry.test_id} />
    </> : <p className="flex-evidence-unavailable">No test-specific report outcomes have been reviewed for this catalog record yet. Burn time, spread rate and extinction conditions are left unavailable.</p>}</section>
    <section><h3>Before and after gas readings</h3><BassGasEvidence gases={entry.gas_readings} /><p className="field-help"><a href={source("catalog")?.url} target="_blank" rel="noreferrer">Catalog · data row {entry.row_ordinal}</a>. Original qualified and missing readings stay visible.</p></section>
    <section><h3>Calculated from the reported values</h3>{entry.derived_metrics.length ? <>
      <dl className="flex-conditions">{entry.derived_metrics.map((m) => <div key={m.key}><dt>{m.label}</dt><dd>{displayNumber(m.value)} {m.unit}</dd></div>)}</dl>
      <p className="field-help">Concentration changes are final minus initial. Percentage points and relative percentages are different quantities. These calculations do not establish cause, uncertainty or an extinction threshold.</p>
      <details><summary>Calculation formulas and input sources</summary><ul className="analytics-comparison-notes">{entry.derived_metrics.map((m) => <li key={m.key}><strong>{m.label}:</strong> {m.formula}. Inputs: {m.inputs.join("; ")}. <a href={source(m.source_key)?.url} target="_blank" rel="noreferrer">{source(m.source_key)?.locator}</a>.</li>)}</ul></details>
    </> : <p className="field-help">No calculation has two usable input readings. Missing and qualified cells are not replaced with zero.</p>}</section>
    <section><h3>NASA’s observations</h3>{entry.researcher_notes ? <>
      <blockquote>{entry.researcher_notes}</blockquote><p className="field-help">Verbatim researcher note from <a href={source("notes")?.url} target="_blank" rel="noreferrer">{source("notes")?.locator}</a>.</p>
      <h3>How to read this note</h3><p>{entry.interpretation}</p>
    </> : <p className="field-help">Test-specific researcher commentary has not yet been reviewed for this record. Notes from another test are not attached.</p>}</section>
    <details className="flex-limits" open={entry.coverage === "catalog_only"}><summary>Data gaps and interpretation limits ({entry.limits.length})</summary><ul>{entry.limits.map((l) => <li key={l}>{l}</li>)}</ul></details>
    <section className="flex-sources"><h3>Sources for this test</h3><ul>{entry.sources.map((s) => <li key={s.key}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a><small>{s.role} · {s.locator} · file version {s.file_version}</small></li>)}</ul><p className="field-help">PSI-25 version {index.investigation_version} · source snapshot {index.source_snapshot}. The download includes source hashes, original catalog cells, formulas and review flags.</p></section>
    <details className="flex-context"><summary>Measurement definitions and calibration context</summary><p><a href={index.measurement_guide.url} target="_blank" rel="noreferrer">{index.measurement_guide.name}</a></p><p className="field-help">{index.measurement_guide.locator}. This guide explains Air display, Fan display, sensor offsets and qualified readings; it is not evidence of this test’s outcome.</p></details>
    <details className="flex-context"><summary>Original catalog row</summary><dl className="analytics-raw-fields">{index.catalog_columns.map((c, i) => <div key={c}><dt>{c}</dt><dd>{entry.catalog_row[i] || "Empty source cell"}</dd></div>)}</dl></details>
    <button onClick={download}>Download this BASS-II summary</button>
  </div>;
}
