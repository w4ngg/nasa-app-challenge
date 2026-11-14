import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { getInvestigation, NotFoundError } from "../lib/data";
import { basisLabels, categoryLabels, percentRange, platformLabels, topicLabels } from "../lib/labels";
import type { ExperimentalTable, FuelCategory, InvestigationDetail as Detail } from "../types";
import { O2Bar } from "./O2Bar";
import { PublicationCard } from "./PublicationCard";

const PREVIEW_ROWS = 25;
const fuelCategoryOrder: FuelCategory[] = ["gas", "liquid", "solid", "aerosol"];
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function formatDate(value: string | null): string | null {
  return value ? monthYear.format(new Date(`${value}T00:00:00Z`)) : null;
}

function TableView({ table }: { table: ExperimentalTable }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? table.rows : table.rows.slice(0, PREVIEW_ROWS);
  const highlighted = new Set([table.fuel_column, table.o2_column].filter(Boolean));
  return (
    <div>
      {table.note && <p className="field-help table-note">{table.note}</p>}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`Table ${table.file_name}, scroll sideways for more columns`}>
        <table>
          <thead>
            <tr>{table.columns.map((c, i) => <th key={i} scope="col" className={highlighted.has(c) ? "col-key" : undefined}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>{row.map((cell, c) => <td key={c} className={highlighted.has(table.columns[c]) ? "col-key" : undefined}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>{rows.length} of {table.rows.length} rows. Highlighted columns are the ones read for fuel and oxygen.</span>
        {table.rows.length > PREVIEW_ROWS && (
          <button type="button" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show first ${PREVIEW_ROWS} rows` : `Show all ${table.rows.length} rows`}
          </button>
        )}
      </div>
    </div>
  );
}

export function InvestigationDetail({ id, backHref, backLabel, onBack, onOpen }: {
  id: string;
  backHref: string;
  backLabel: string;
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tableIndex, setTableIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setTableIndex(0);
    getInvestigation(id)
      .then((next) => { if (!cancelled) setDetail(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof NotFoundError ? "missing" : "failed"); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  useEffect(() => {
    if (detail) document.title = `${detail.investigation.acronym || detail.investigation.id} | Flame Atlas`;
    return () => { document.title = "Flame Atlas"; };
  }, [detail]);

  const back = <a className="back-link" href={backHref} onClick={onBack}>{backLabel}</a>;

  if (error) {
    return (
      <section className="detail">
        {back}
        <div className="state" role="alert">
          <h1 className="state-title">{error === "missing" ? `No investigation ${id} in this catalog` : "The investigation could not be loaded"}</h1>
          <p>{error === "missing" ? "The ID may be wrong, or the investigation is outside Combustion Science." : "Check your connection and try again."}</p>
          {error === "failed" && <button type="button" onClick={() => setAttempt((v) => v + 1)}>Try again</button>}
        </div>
      </section>
    );
  }
  if (!detail) {
    return <section className="detail">{back}<p className="state" role="status">Loading {id}…</p></section>;
  }

  const { investigation: inv, publications, tables, related } = detail;
  const c = inv.conditions;
  const period = [formatDate(inv.start_date), formatDate(inv.end_date)].filter(Boolean).join(" to ");
  const table = tables[tableIndex];
  const facts: [string, string | null][] = [
    ["Test environment", platformLabels[inv.platform]],
    ["Flight program", inv.flight_program],
    ["Period", period || null],
    ["Hardware", inv.hardware],
    ["PSI sub-area", inv.sub_research_area ? `${inv.sub_research_area} (${topicLabels[inv.topic]})` : null],
  ];

  return (
    <article className="detail">
      {back}
      <header className="detail-header">
        <p className="eyebrow">{[inv.id, inv.acronym].filter(Boolean).join(" · ")}</p>
        <h1>{inv.title}</h1>
        <dl className="facts">
          {facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <p className="detail-links">
          <a href={inv.source_url} target="_blank" rel="noreferrer">Open the original NASA PSI record</a>
          {inv.dataset_doi && <a href={`https://doi.org/${inv.dataset_doi}`} target="_blank" rel="noreferrer">Dataset DOI: {inv.dataset_doi}</a>}
        </p>
      </header>

      <section className="panel" aria-labelledby="conditions-title">
        <h2 id="conditions-title">Test conditions</h2>
        {c.run_count === 0 ? (
          <p className="field-help">PSI has no experiment table for this investigation, so fuel and oxygen are not identified.</p>
        ) : (
          <div className="conditions-grid">
            <div>
              <h3>Fuels and materials</h3>
              {c.fuels.length === 0 ? <p className="o2-missing">The experiment table does not name the materials.</p> : (
                fuelCategoryOrder.filter((cat) => c.fuel_categories.includes(cat)).map((cat) => (
                  <div key={cat} className="subgroup">
                    <p className="subgroup-title">{categoryLabels[cat]}</p>
                    <ul className="tags">
                      {c.fuels.filter((f) => c.fuel_groups[f] === cat).map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </div>
                ))
              )}
            </div>
            <div>
              <h3>Oxygen</h3>
              <O2Bar observations={c.o2} />
              {c.o2.length > 0 && (
                <ul className="o2-sources">
                  {c.o2.map((o) => (
                    <li key={`${o.source_file}-${o.basis}`}>
                      <strong>{percentRange(o.min_percent, o.max_percent)}</strong>, {basisLabels[o.basis]}.
                      {" "}From column “{o.source_column}”, recorded in {o.runs_with_value} runs.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {c.run_count > 0 && (
          <p className="field-help">
            Extracted automatically from {c.tables.length} PSI experiment {c.tables.length === 1 ? "table" : "tables"} ({c.run_count.toLocaleString("en-US")} runs).
            Fuel names are merged with a dictionary, so “C2H4” and “100% C2H4” both count as Ethylene. Check them against the source data below.
          </p>
        )}
      </section>

      {tables.length > 0 && table && (
        <section className="panel" aria-labelledby="tables-title">
          <h2 id="tables-title">Experiment tables</h2>
          {tables.length > 1 && (
            <div className="segmented" role="group" aria-label="Choose a table">
              {tables.map((t, i) => (
                <button key={t.file_name} type="button" aria-pressed={i === tableIndex} onClick={() => setTableIndex(i)}>
                  {t.file_name.replace(`${inv.id}_Experimental table_`, "").replace(/\.csv$/, "")}
                </button>
              ))}
            </div>
          )}
          <TableView key={table.file_name} table={table} />
        </section>
      )}

      <section className="panel prose" aria-labelledby="description-title">
        <h2 id="description-title">Description from NASA PSI</h2>
        {inv.objective && <><h3>Objectives</h3><p className="source-text">{inv.objective}</p></>}
        {inv.approach && <><h3>Approach</h3><p className="source-text">{inv.approach}</p></>}
        {inv.hypothesis && <details><summary>Hypothesis</summary><p className="source-text">{inv.hypothesis}</p></details>}
        {inv.research_impacts && <details><summary>Research impacts and Earth benefits</summary><p className="source-text">{inv.research_impacts}</p></details>}
      </section>

      {related.length > 0 && (
        <section className="panel" aria-labelledby="related-title">
          <h2 id="related-title">Related investigations</h2>
          <ul className="related">
            {related.map((r) => (
              <li key={r.id}>
                {r.title ? <a href={`?id=${r.id}`} onClick={(e) => onOpen(e, r.id)}>{r.id}: {r.title}</a>
                  : <span>{r.id} (outside Combustion Science)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel panel-flush" aria-labelledby="publications-title">
        <h2 id="publications-title">Related publications ({publications.length})</h2>
        {publications.length === 0 ? <p className="state">PSI lists no publications for this investigation.</p>
          : publications.map((p) => <PublicationCard key={p.id} record={p} />)}
      </section>
    </article>
  );
}
