import { useEffect, useRef, useState } from "react";
import { FlexHistory } from "./FlexHistory";
import { loadFlexHistory } from "../lib/flex";
import type { FlexHistory as History, FlexIndex, FlexTestSummary } from "../lib/flex";

export function FlexSummaryPanel({ testId, entry, index, error, onClose, onRetry }: {
  testId: string; entry: FlexTestSummary | null; index: FlexIndex | null;
  error: string; onClose: () => void; onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="flex-summary-panel" aria-labelledby="flex-summary-title" onClose={onClose}
    onClick={(event) => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current.close(); } }}>
    <header className="flex-summary-header">
      <div><p className="eyebrow">PSI-69 · Experiment summary</p><h2 id="flex-summary-title">{entry?.name ?? `Catalog test ${testId}`}</h2>{entry && <p>Catalog test {entry.test_id} · CIR {entry.cir_id}<br />{coverageLabel[entry.coverage]}</p>}</div>
      <button autoFocus onClick={() => dialog.current?.close()} aria-label="Close experiment summary">Close</button>
    </header>
    {!index && !error ? <p className="state" role="status">Loading the experiment summary…</p>
      : error ? <div className="state" role="alert"><h3>Could not load the summary</h3><p>{error}</p><button onClick={onRetry}>Try again</button></div>
        : !entry ? <div className="state" role="alert"><h3>Summary unavailable for this source row</h3><p>The summary must match both the FLEX identifier and the complete source row. Its data may belong to a different catalog version.</p></div>
          : <SummaryContent key={`${entry.test_id}/${entry.cir_id}`} entry={entry} index={index!} />}
  </dialog>;
}

const coverageLabel = { series_and_notes: "Time series and NASA notes", series: "Time series available", notes: "NASA notes available", catalog_only: "Catalog data only" };

function SummaryContent({ entry, index }: { entry: FlexTestSummary; index: FlexIndex }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const sheet = entry.sources.find((s) => s.role === "TestSheet");
  useEffect(() => {
    if (!evidenceOpen || !entry.history_path) return;
    let cancelled = false;
    setError("");
    loadFlexHistory(entry).then((value) => { if (!cancelled) setHistory(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the time history."); });
    return () => { cancelled = true; };
  }, [evidenceOpen, entry, attempt]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ investigation_id: "PSI-69", investigation_version: index.investigation_version,
      source_snapshot: index.source_snapshot, ...entry }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${entry.name}-summary.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="flex-summary-body">
    {entry.source_test_id !== null && entry.source_test_id !== entry.test_id && <p className="flex-source-match">Catalog test {entry.test_id} is linked to source {entry.name} by CIR {entry.cir_id}. The two numbering systems differ.</p>}
    {entry.source_conflicts.length > 0 && <section className="flex-source-conflicts"><h3>Source values need review</h3><ul>{entry.source_conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul></section>}
    <section><h3>What happened in this test?</h3><p className="flex-summary-lede">{entry.summary}</p></section>
    <section><h3>Recorded conditions</h3><dl className="flex-conditions">{entry.conditions.map((condition) => <div key={condition.label}><dt>{condition.label}</dt><dd>{condition.value}</dd></div>)}</dl><p className="field-help">Gas fractions are the catalog values. More precise values in individual source files may differ.</p></section>
    <section><h3>NASA’s observations and interpretation</h3>{entry.researcher_excerpt
      ? <><blockquote>{entry.researcher_excerpt}</blockquote><p className="field-help">Excerpt from <a href={sheet?.url} target="_blank" rel="noreferrer">this test’s NASA TestSheet</a>; the interpretation is attributed to the researchers.</p>
        {entry.researcher_notes !== entry.researcher_excerpt && <details className="flex-full-notes"><summary>Read the complete test notes</summary><p>{entry.researcher_notes}</p></details>}</>
      : <p className="field-help">No researcher commentary was found for this test. The summary reports the available measurements without assigning a combustion mechanism.</p>}</section>
    {entry.history_path ? <details className="flex-evidence" onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}>
      <summary>View evidence · measured time histories</summary>
      {evidenceOpen && (error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt((n) => n + 1)}>Try loading the measurements again</button></div>
        : history ? <FlexHistory history={history} /> : <p role="status" className="field-help">Loading the recorded time series…</p>)}
    </details> : <p className="flex-evidence-unavailable">No time-history data are available in the reviewed files for this test. The catalog summary and any test notes remain available.</p>}
    {entry.limits.length > 0 && <details className="flex-limits" open={entry.coverage === "catalog_only"}><summary>Data gaps and limits ({entry.limits.length})</summary><ul>{entry.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></details>}
    <section className="flex-sources"><h3>Sources for this test</h3><ul>{entry.sources.map((source) => <li key={source.file_id}><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a><small>{source.role === "catalog" ? `Experimental table · data row ${source.row_ordinal}` : source.role} · file version {source.file_version}</small></li>)}</ul><p className="field-help">PSI-69 version {index.investigation_version} · source inventory {index.source_snapshot}.</p></section>
    <details className="flex-context"><summary>Background publications</summary><p className="field-help">These explain methods and FLEX results at investigation level. They are not automatically assigned as evidence for this individual test.</p><ul>{index.context_publications.map((publication) => <li key={publication.url}><a href={publication.url} target="_blank" rel="noreferrer">{publication.title}</a><small>{publication.role}</small></li>)}</ul></details>
    <button onClick={download}>Download this experiment summary</button>
  </div>;
}
