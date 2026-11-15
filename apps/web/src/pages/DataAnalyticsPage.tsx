import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { AnalyticsScatter } from "../components/AnalyticsScatter";
import { ResizableBox } from "../components/Resizable";
import { SaffireSamples } from "../components/SaffireSamples";
import { FlexSummaryPanel } from "../components/FlexSummaryPanel";
import {
  analyticsCsv, analyticsDatasets, comparisonNotes, displayNumber, emptyAnalyticsFilters,
  filterError, filterRows, metricLabel, normalizeTable, plotRows,
} from "../lib/analytics";
import type { AnalyticsFilters, AnalyticsRow, DatasetSpec } from "../lib/analytics";
import { getInvestigation } from "../lib/data";
import { viewUrl } from "../lib/route";
import { readSaffire } from "../lib/saffire";
import { flexAssetUrl, loadFlexSummaries, summaryForRow } from "../lib/flex";
import type { FlexIndex } from "../lib/flex";
import type { InvestigationDetail } from "../types";
import "./data-analytics.css";

type Link = (event: MouseEvent<HTMLAnchorElement>) => void;
const pageSize = 25;

export function DataAnalyticsPage({ onLink, initialDataset }: { onLink: Link; initialDataset?: string }) {
  // ?view=lab&dataset=flex opens that table (used by links from the research assistant)
  const [datasetKey, setDatasetKey] = useState(() => analyticsDatasets.find((d) => d.key === initialDataset)?.key ?? analyticsDatasets[0].key);
  useEffect(() => {
    if (initialDataset && analyticsDatasets.some((d) => d.key === initialDataset)) setDatasetKey(initialDataset);
  }, [initialDataset]);
  const [loaded, setLoaded] = useState<{ key: string; detail: InvestigationDetail } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const spec = analyticsDatasets.find((d) => d.key === datasetKey)!;

  useEffect(() => {
    let cancelled = false;
    setLoaded(null); setError("");
    getInvestigation(spec.id).then((result) => {
      if (cancelled) return;
      const table = result.tables.find((t) => t.file_name === spec.file);
      if (!table) throw new Error("The reviewed experiment table is unavailable.");
      if (spec.mode === "sample_comparison") readSaffire(table);
      else normalizeTable(table, spec); // Fail closed if a future export changes the reviewed schema.
      setLoaded({ key: datasetKey, detail: result });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this dataset.");
    });
    return () => { cancelled = true; };
  }, [datasetKey, spec, attempt]);

  return (
    <div className="page analytics-page">
      <header className="page-header">
        <h1>Data analytics</h1>
        <p>Explore recorded measurements, compare individual tests and trace each value to its source table.</p>
      </header>
      <section className="panel analytics-dataset" aria-labelledby="dataset-heading">
        <h2 id="dataset-heading">1. Choose an experiment table</h2>
        <label className="analytics-field">Reviewed dataset
          <select value={datasetKey} onChange={(event) => setDatasetKey(event.target.value)}>{analyticsDatasets.map((d) => <option value={d.key} key={d.key}>{d.name} ({d.id})</option>)}</select>
        </label>
        <p className="analytics-description">{spec.description}</p>
        <p className="field-help">This MVP supports {analyticsDatasets.length} reviewed tables across {new Set(analyticsDatasets.map((d) => d.id)).size} investigations. Other investigations remain available in the <a href={viewUrl("explorer")} onClick={onLink}>experiment library</a>.</p>
      </section>
      {error ? <section className="panel state" role="alert"><h2>Could not load the experiment table</h2><p>{error}</p><button onClick={() => setAttempt((a) => a + 1)}>Try again</button></section>
        : loaded?.key === datasetKey ? spec.mode === "sample_comparison"
          ? <SaffireSamples key={datasetKey} detail={loaded.detail} spec={spec} />
          : <AnalyticsWorkspace key={datasetKey} detail={loaded.detail} spec={spec} />
          : <p className="state" role="status">Loading the source table…</p>}
    </div>
  );
}

function AnalyticsWorkspace({ detail, spec }: { detail: InvestigationDetail; spec: DatasetSpec }) {
  const table = detail.tables.find((t) => t.file_name === spec.file)!;
  const rows = useMemo(() => normalizeTable(table, spec), [table, spec]);
  const [filters, setFilters] = useState<AnalyticsFilters>({ ...emptyAnalyticsFilters });
  const [x, setX] = useState(spec.defaultX);
  const [y, setY] = useState(spec.defaultY);
  const [group, setGroup] = useState(spec.defaultGroup);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [comparedKeys, setComparedKeys] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [tableMode, setTableMode] = useState<"all" | "excluded">("all");
  const [notice, setNotice] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [flexIndex, setFlexIndex] = useState<FlexIndex | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryAttempt, setSummaryAttempt] = useState(0);

  useEffect(() => {
    if (spec.id !== "PSI-69") return;
    let cancelled = false;
    setSummaryError("");
    loadFlexSummaries().then((index) => { if (!cancelled) setFlexIndex(index); })
      .catch((reason: unknown) => { if (!cancelled) setSummaryError(reason instanceof Error ? reason.message : "Could not load the FLEX experiment summaries."); });
    return () => { cancelled = true; };
  }, [spec.id, summaryAttempt]);

  const error = filterError(filters, spec);
  const filtered = useMemo(() => filterRows(rows, filters, spec), [rows, filters, spec]);
  const plotted = useMemo(() => plotRows(filtered, x, y), [filtered, x, y]);
  const plottedKeys = new Set(plotted.map((r) => r.key));
  const excluded = filtered.filter((r) => !plottedKeys.has(r.key));
  const tableRows = tableMode === "excluded" ? excluded : filtered;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const shown = tableRows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selected = filtered.find((r) => r.key === selectedKey);
  const selectedSummary = selected && flexIndex ? summaryForRow(flexIndex, selected, table) : null;
  const matchedSummaries = useMemo(() => flexIndex ? rows.filter((r) => summaryForRow(flexIndex, r, table)).length : 0, [flexIndex, rows, table]);
  const compared = filtered.filter((r) => comparedKeys.includes(r.key));
  const xMetric = spec.metrics.find((m) => m.key === x)!;
  const yMetric = spec.metrics.find((m) => m.key === y)!;
  const materials = [...new Set(rows.map((r) => r.material))].sort();
  const category = spec.categories[0];
  const categories = [...new Set(rows.map((r) => r.categories[category.key]))].sort();
  const hasPressure = spec.metrics.some((m) => m.key === "pressure");
  const pressureMetric = spec.metrics.find((m) => m.key === "pressure");
  const oxygenMetric = spec.metrics.find((m) => m.key === "o2")!;
  const ignition = spec.categories.find((c) => c.key === "ignition");
  const ignitionValues = [...new Set(rows.map((r) => r.categories.ignition))].filter(Boolean).sort();
  const materialLabel = spec.materialColumn === "Fuel" ? "Fuel" : "Material description (source)";
  const changes = (patch: Partial<AnalyticsFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch })); setPage(0); setSelectedKey(null); setComparedKeys([]); setNotice("");
    setSummaryOpen(false);
  };
  const selectPlotRow = (row: AnalyticsRow) => {
    setSelectedKey(row.key);
    setTableMode("all");
    setPage(Math.floor(filtered.indexOf(row) / pageSize));
    if (spec.id === "PSI-69") setSummaryOpen(true);
  };
  const axisChange = (key: string, axis: "x" | "y") => {
    if (axis === "x") setX(key); else setY(key);
    setPage(0); setNotice("");
  };
  const toggleCompare = (key: number) => {
    setComparedKeys((previous) => previous.includes(key) ? previous.filter((k) => k !== key) : [...previous, key]);
  };
  const exportCsv = () => {
    const content = analyticsCsv({ rows: filtered, table, spec, sourceUrl: detail.investigation.source_url, filters, x, y, group });
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${spec.key}-filtered-measurements.csv`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${filtered.length} filtered rows, including rows excluded from the plot, with units, quality flags and source fields.`);
  };
  const example = () => {
    setFilters({ ...emptyAnalyticsFilters, material: "Methanol", category: "Extinction", o2Min: "21", o2Max: "21", pressureMin: "740", pressureMax: "780" });
    setX("diameter"); setY("burnTime"); setGroup("endpoint"); setPage(0); setTableMode("all"); setSelectedKey(null); setComparedKeys([]); setNotice("");
    setSummaryOpen(false);
  };
  const flexExample = () => {
    const row = rows.find((r) => r.testId === "35");
    if (!row) return;
    setFilters({ ...emptyAnalyticsFilters }); setX("diameter"); setY("burnTime"); setGroup("endpoint");
    setTableMode("all"); setPage(Math.floor(rows.indexOf(row) / pageSize));
    setSelectedKey(row.key); setSummaryOpen(true); setNotice("");
  };
  const qualityReasons = [...new Set(excluded.flatMap((r) => [x, y].map((k) => r.cells[k].issue).filter(Boolean)))];

  return (
    <>
      <section className="panel" aria-labelledby="conditions-heading">
        <div className="analytics-section-head"><h2 id="conditions-heading">2. Select the recorded conditions</h2><button className="link-button" onClick={() => changes({ ...emptyAnalyticsFilters })}>Reset filters</button></div>
        <div className="analytics-filter-grid">
          <label className="analytics-field">{materialLabel}
            <select value={filters.material} onChange={(event) => changes({ material: event.target.value })}><option value="">All recorded materials</option>{materials.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="analytics-field">{category.label}
            <select value={filters.category} onChange={(event) => changes({ category: event.target.value })}><option value="">All {category.label.toLowerCase()} values</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          {ignition && <label className="analytics-field">{ignition.label}<select value={filters.ignition} onChange={(event) => changes({ ignition: event.target.value })}><option value="">All hot-ignition values</option>{ignitionValues.map((value) => <option key={value}>{value}</option>)}</select></label>}
          <NumericRange label={metricLabel(oxygenMetric)} name="o2" min={filters.o2Min} max={filters.o2Max}
            invalid={Boolean(error?.startsWith("O₂"))} onChange={(low, high) => changes({ o2Min: low, o2Max: high })} />
          {hasPressure && <NumericRange label={metricLabel(pressureMetric!)} name="pressure" min={filters.pressureMin} max={filters.pressureMax}
            invalid={Boolean(error?.startsWith("Pressure"))} onChange={(low, high) => changes({ pressureMin: low, pressureMax: high })} />}
        </div>
        {error && <p className="field-error" id="analytics-filter-error" role="alert">{error}</p>}
        <p className="field-help">Bounds are inclusive. An active numeric filter excludes rows missing that condition. Blank bounds leave that condition unrestricted.</p>
        {spec.id === "PSI-69" && <button className="link-button analytics-example" onClick={example}>Try a focused subset: methanol · 21% O₂ · 740–780 mmHg · extinction</button>}
      </section>

      <section className="panel panel-focus" aria-labelledby="plot-heading">
        <h2 id="plot-heading">3. How do the recorded measurements compare?</h2>
        <div className="analytics-axis-controls">
          <label className="analytics-field">X axis<select value={x} onChange={(event) => axisChange(event.target.value, "x")}>{spec.metrics.map((m) => <option value={m.key} key={m.key}>{metricLabel(m)}</option>)}</select></label>
          <label className="analytics-field">Y axis<select value={y} onChange={(event) => axisChange(event.target.value, "y")}>{spec.metrics.map((m) => <option value={m.key} key={m.key}>{metricLabel(m)}</option>)}</select></label>
          <label className="analytics-field">Group points by<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">No grouping</option>{spec.materialColumn === "Fuel" && <option value="material">Fuel</option>}{spec.categories.map((c) => <option value={c.key} key={c.key}>{c.label}</option>)}</select></label>
        </div>
        <p className="analytics-counts" role="status"><strong>{plotted.length}</strong> plotted · <strong>{filtered.length}</strong> rows match filters · {rows.length - filtered.length} filtered out · {rows.length} source rows</p>
        {spec.id === "PSI-69" && <div className="flex-summary-intro">
          <div><h3>Read the experiment behind each point</h3>
            {summaryError ? <p role="alert">{summaryError} <button className="link-button" onClick={() => setSummaryAttempt((n) => n + 1)}>Try again</button></p>
              : flexIndex ? <p>{matchedSummaries} catalog test records have matched summaries. Select a point or test number for conditions, NASA’s notes and measured time histories. Source file numbers may differ from catalog test numbers; both are shown.</p>
                : <p role="status">Loading the FLEX experiment summaries…</p>}
          </div>
          <div><button onClick={flexExample}>Explore FLEX-035</button>{flexIndex && <a href={flexAssetUrl("summaries.json")} download="PSI-69-experiment-summaries.json">Download all summaries</a>}</div>
        </div>}
        {table.note && <p className="analytics-quality">{table.note}</p>}
        {spec.id === "PSI-159" && <p className="analytics-quality">Zero recorded burn times are retained. Use Hot ignition and Test end to distinguish outcomes. Pressure is approximate; peak burner temperature is not flame temperature.</p>}
        {excluded.length > 0 && <p className="analytics-quality">{excluded.length} matching rows are excluded from this plot: {qualityReasons.join("; ").toLowerCase()}. <a href="#analytics-measurements" onClick={() => { setTableMode("excluded"); setPage(0); }}>Review excluded rows</a>.</p>}
        {x === y && <p className="analytics-quality">Both axes show the same quantity. Choose different quantities to explore their relationship.</p>}
        {filtered.length > 0 && (
          <ResizableBox axes="both" minWidth={300} minHeight={240} maxHeight={1100} storageKey="fa-resize-analytics-plot">
            <AnalyticsScatter key={`${spec.id}-${x}-${y}-${group}`} rows={plotted} x={xMetric} y={yMetric} group={group} selected={selectedKey} onSelect={selectPlotRow}
              selectionHint={spec.id === "PSI-69" ? "Select a point to read its experiment summary and source evidence." : undefined} />
          </ResizableBox>
        )}
        {filtered.length === 0 && <div className="state analytics-empty"><h3>{error ? "Correct the filter bounds" : "No rows match these conditions"}</h3><p>Adjust or reset the filters to see recorded measurements.</p><button onClick={() => changes({ ...emptyAnalyticsFilters })}>Reset filters</button></div>}
        <p className="field-help">Each point is one source-table row. Axes fit the visible values. Overlapping points can be inspected individually in the table. A pattern here does not establish cause, a safe operating limit or a prediction.</p>
        {selected && <p className="analytics-notice">Test {selected.testId} is selected. {spec.id === "PSI-69" && <><button className="link-button" onClick={() => setSummaryOpen(true)}>Read experiment summary</button> · </>}<a href="#analytics-source">Inspect its complete source row</a>.</p>}
      </section>

      <section className="panel" id="analytics-measurements" aria-labelledby="measurements-heading">
        <div className="analytics-section-head"><h2 id="measurements-heading">4. Inspect and compare test rows</h2><button disabled={!filtered.length || Boolean(error)} onClick={exportCsv}>Export filtered CSV ({filtered.length})</button></div>
        <p className="panel-lede">{spec.id === "PSI-69" ? "Open a test to read its experiment summary and source evidence." : "Open a test to see every source field."} Select up to three rows for a descriptive comparison.</p>
        <div className="segmented" aria-label="Rows shown in the table"><button aria-pressed={tableMode === "all"} onClick={() => { setTableMode("all"); setPage(0); }}>All matching ({filtered.length})</button><button aria-pressed={tableMode === "excluded"} onClick={() => { setTableMode("excluded"); setPage(0); }}>Excluded from plot ({excluded.length})</button></div>
        {notice && <p className="analytics-notice" role="status">{notice}</p>}
        <ResizableBox axes="both" minWidth={280} minHeight={180} maxHeight={1200} storageKey="fa-resize-analytics-table">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Filtered measurements">
            <table className="analytics-table"><caption className="sr-only">Filtered source rows. X and Y values use the units in the column headings.</caption>
              <thead><tr><th scope="col">Compare</th><th scope="col">Test / data row</th><th scope="col">{materialLabel}</th><th scope="col">{category.label}</th>{ignition && <th scope="col">{ignition.label}</th>}<th scope="col">{metricLabel(xMetric)}</th><th scope="col">{metricLabel(yMetric)}</th><th scope="col">Plot status</th></tr></thead>
              <tbody>{shown.map((row) => <tr key={row.key} className={selectedKey === row.key ? "analytics-row-selected" : undefined}>
                <td><input type="checkbox" aria-label={`Compare test ${row.testId}, data row ${row.key}`} checked={comparedKeys.includes(row.key)} disabled={comparedKeys.length >= 3 && !comparedKeys.includes(row.key)} onChange={() => toggleCompare(row.key)} /></td>
                <th scope="row"><button className="link-button" aria-label={`Inspect test ${row.testId}, data row ${row.key}`} aria-pressed={selectedKey === row.key} onClick={() => selectPlotRow(row)}>Test {row.testId}</button><small>Data row {row.key}</small>{flexIndex && summaryForRow(flexIndex, row, table)?.source_test_id !== row.testId && <small>{summaryForRow(flexIndex, row, table)?.name}</small>}</th>
                <td title={row.material}>{row.material}</td><td>{row.categories[category.key]}</td>{ignition && <td>{row.categories.ignition}</td>}
                <td>{displayNumber(row.cells[x].value)}{row.cells[x].issue && <small>{row.cells[x].issue}</small>}</td>
                <td>{displayNumber(row.cells[y].value)}{row.cells[y].issue && <small>{row.cells[y].issue}</small>}</td>
                <td>{plottedKeys.has(row.key) ? "Plotted" : "Excluded: X or Y unavailable"}</td>
              </tr>)}{!shown.length && <tr><td colSpan={7 + (ignition ? 1 : 0)}>No rows in this view.</td></tr>}</tbody>
            </table>
          </div>
        </ResizableBox>
        <div className="pagination"><span>{tableRows.length ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, tableRows.length)} of ${tableRows.length}` : "0 rows"}</span><div><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button><span>Page {safePage + 1} of {pageCount}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button></div></div>
        {selected && <p className="analytics-notice">Test {selected.testId} · data row {selected.key}. <a href="#analytics-source">Inspect the complete source row</a>.</p>}
        {compared.length > 0 && <div className="analytics-comparison">
          <div className="analytics-section-head"><h3>Selected tests ({compared.length}/3)</h3><button className="link-button" onClick={() => setComparedKeys([])}>Clear comparison</button></div>
          {compared.length === 1 ? <p className="field-help">Select one more row to compare its recorded measurements.</p> : <>
            <ul className="analytics-comparison-notes">{comparisonNotes(compared, spec).map((note) => <li key={note}>{note}</li>)}</ul>
            <ResizableBox axes="both" minWidth={280} minHeight={140} maxHeight={1000} storageKey="fa-resize-analytics-compare">
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Selected test comparison"><table><thead><tr><th scope="col">Recorded field</th>{compared.map((r) => <th scope="col" key={r.key}>Test {r.testId} · row {r.key}</th>)}</tr></thead>
                <tbody><tr><th scope="row">Material / fuel</th>{compared.map((r) => <td key={r.key} title={r.material}>{r.material}</td>)}</tr>
                  {spec.categories.map((c) => <tr key={c.key}><th scope="row">{c.label}</th>{compared.map((r) => <td key={r.key}>{r.categories[c.key]}</td>)}</tr>)}
                  {spec.metrics.map((m) => <tr key={m.key}><th scope="row">{metricLabel(m)}</th>{compared.map((r) => <td key={r.key}>{displayNumber(r.cells[m.key].value)}{r.cells[m.key].issue && <small>{r.cells[m.key].issue}</small>}</td>)}</tr>)}
                </tbody></table></div>
            </ResizableBox>
          </>}
        </div>}
      </section>

      <section className="panel analytics-source" id="analytics-source" aria-labelledby="source-heading">
        <h2 id="source-heading">5. Check the source and its limits</h2>
        <p className="panel-lede">{spec.limits}</p>
        <p className="sources">Source: <a href={detail.investigation.source_url} target="_blank" rel="noreferrer">NASA PSI · {spec.id}</a> · <span>{table.file_name}</span>. Data-row ordinals start at 1 after the exported header; they are not physical CSV line numbers. <a href={`${viewUrl("lab")}&id=${spec.id}`} target="_blank" rel="noreferrer">Open investigation details (new tab)</a>.</p>
        {table.note && <p className="sources">Source note: {table.note}</p>}
        {selected ? <>
          <div className="analytics-section-head"><h3>Source row {selected.key} · Test {selected.testId}</h3><button className="link-button" onClick={() => setSelectedKey(null)}>Close row</button></div>
          <dl className="analytics-raw-fields">{table.columns.map((column, index) => <div key={column}><dt>{column}</dt><dd>{selected.raw[index] || <span className="muted">Empty source cell</span>}</dd></div>)}</dl>
        </> : <p className="analytics-source-prompt">Select a chart point or “Test” in the table to inspect the complete, unmodified source row.</p>}
        <details className="analytics-method"><summary>How numeric values and exports are handled</summary>
          <ul><li>Only scalar numeric cells inside physical bounds enter the plot. Values such as “~6”, lists and ranges keep their original text and are not treated as exact points. CFI-G pressure is explicitly labelled approximate in the interface and CSV.</li><li>FLEX and CFI-G oxygen fractions are multiplied by 100 to obtain mol %. BASS-II oxygen is already vol %. CFI-G inverse-flame oxygen is burner-fed. Pressure stays in each source unit: mmHg for FLEX, bar for CFI-G. Tables are analysed separately.</li><li>CSV exports contain all rows matching the filters, whether plotted or excluded, with the selected axes, filters, normalized values, quality flags, original cells and source links. Text that could be interpreted as a spreadsheet formula receives an apostrophe prefix.</li><li>No values are imputed, no sensor outliers are silently corrected, and no predictive model or inferred uncertainty is added.</li></ul>
        </details>
      </section>
      {spec.id === "PSI-69" && selected && summaryOpen && <FlexSummaryPanel testId={selected.testId} entry={selectedSummary} index={flexIndex}
        error={summaryError} onClose={() => setSummaryOpen(false)} onRetry={() => setSummaryAttempt((n) => n + 1)} />}
    </>
  );
}

function NumericRange({ label, name, min, max, invalid, onChange }: {
  label: string; name: string; min: string; max: string; invalid: boolean;
  onChange: (min: string, max: string) => void;
}) {
  // Text + decimal input mode preserves incomplete/invalid entries so validation
  // can explain them instead of browsers silently turning an invalid number into an empty filter.
  return <fieldset className="analytics-range"><legend>{label}</legend><div>
    <label htmlFor={`${name}-min`}>Min<input id={`${name}-min`} inputMode="decimal" value={min} placeholder="Any" aria-invalid={invalid} aria-describedby={invalid ? "analytics-filter-error" : undefined} onChange={(event) => onChange(event.target.value, max)} /></label>
    <label htmlFor={`${name}-max`}>Max<input id={`${name}-max`} inputMode="decimal" value={max} placeholder="Any" aria-invalid={invalid} aria-describedby={invalid ? "analytics-filter-error" : undefined} onChange={(event) => onChange(min, event.target.value)} /></label>
  </div></fieldset>;
}
