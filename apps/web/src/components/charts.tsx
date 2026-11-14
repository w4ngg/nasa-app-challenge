// Row charts for the dashboard: one row per item, a label, a mark on a shared axis,
// and the figure at the end of the row. Every row is a link with a hover/focus
// readout, and every chart has a table view (dataviz rules: tooltips never gate).
import type { MouseEvent, ReactNode } from "react";
import { basisLabels, categoryLabels, percentRange } from "../lib/labels";
import type { FuelCategory, Investigation } from "../types";

type Click = (event: MouseEvent<HTMLAnchorElement>) => void;

function Axis({ ticks }: { ticks: { at: number; label: string }[] }) {
  return (
    <div className="rowchart-axis" aria-hidden="true">
      <span />
      <span className="axis-track">
        {ticks.map((t) => <span key={t.label} className="axis-tick" style={{ left: `${t.at}%` }}>{t.label}</span>)}
      </span>
      <span />
    </div>
  );
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="table-view">
      <summary>Show as a table</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const percentTicks = [0, 20, 40, 60, 80, 100].map((v) => ({ at: v, label: `${v}%` }));
const categoryOrder: FuelCategory[] = ["solid", "liquid", "gas", "aerosol"];

export interface Reference { value: number; label: string; selected?: boolean }

/** Tested oxygen ranges per investigation, grouped by what was burned. */
export function OxygenCoverage({ records, references, hrefFor, onClick }: {
  records: Investigation[];
  references: Reference[];
  hrefFor: (id: string) => string;
  onClick: Click;
}) {
  const withO2 = records.filter((r) => r.conditions.o2.length > 0);
  const groups = categoryOrder
    .map((category) => ({ category, rows: withO2.filter((r) => r.conditions.fuel_categories[0] === category) }))
    .filter((g) => g.rows.length > 0);
  // Lines are always drawn; a label close to the selected level is left to the legend,
  // and the remaining labels anchor away from each other (lowest to the left, highest to the right).
  const selected = references.find((r) => r.selected);
  const sortedRefs = [...references].sort((a, b) => a.value - b.value);
  const labelled = sortedRefs.filter((r) => r.selected || !selected || Math.abs(r.value - selected.value) >= 12);
  const anchor = (r: Reference) => {
    if (labelled.length < 2 || !labelled.includes(r)) return "";
    if (r === labelled[0]) return " anchor-end";
    return r === labelled[labelled.length - 1] ? " anchor-start" : "";
  };
  return (
    <>
      <div className="rowchart has-refs">
        <div className="ref-layer" aria-hidden="true">
          {sortedRefs.map((r) => (
            <span key={`${r.label}-${r.value}`} className={`ref-line${r.selected ? " selected" : ""}${anchor(r)}`} style={{ left: `${r.value}%` }}>
              {labelled.includes(r) && <span className="ref-label">{r.value}%</span>}
            </span>
          ))}
        </div>
        <Axis ticks={percentTicks} />
        {groups.map((group) => (
          <div key={group.category}>
            <p className="rowchart-group">{categoryLabels[group.category]}</p>
            {group.rows.map((r) => {
              const min = Math.min(...r.conditions.o2.map((o) => o.min_percent));
              const max = Math.max(...r.conditions.o2.map((o) => o.max_percent));
              const summary = r.conditions.o2.map((o) => `${percentRange(o.min_percent, o.max_percent)} ${basisLabels[o.basis]}`).join("; ");
              return (
                <a key={r.id} className="chart-row" href={hrefFor(r.id)} onClick={onClick}
                  aria-label={`${r.acronym || r.id}: ${summary}. Fuels: ${r.conditions.fuels.join(", ")}.`}>
                  <span className="row-label">{r.acronym || r.id}<small>{r.id}</small></span>
                  <span className="row-track">
                    <span className="bar-base" />
                    {r.conditions.o2.map((o) => (
                      <span key={`${o.source_file}-${o.basis}`} className={`mark-range ${o.basis}`}
                        style={{ left: `${o.min_percent}%`, width: `max(6px, ${o.max_percent - o.min_percent}%)` }} />
                    ))}
                  </span>
                  <span className="row-value">{percentRange(min, max)}</span>
                  <span className="tip" aria-hidden="true">
                    <strong>{r.title}</strong>
                    {r.conditions.o2.map((o) => (
                      <span key={o.source_file + o.basis} style={{ display: "block" }}>
                        {percentRange(o.min_percent, o.max_percent)}, {basisLabels[o.basis]}, {o.runs_with_value} runs
                      </span>
                    ))}
                    <span style={{ display: "block" }}>{r.conditions.fuels.join(", ")}</span>
                  </span>
                </a>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="legend">
        <li><span className="swatch ambient" aria-hidden="true" />Chamber atmosphere</li>
        <li><span className="swatch oxidizer_stream" aria-hidden="true" />Oxygen fed through the burner</li>
        {references.map((r) => (
          <li key={r.label}><span className={r.selected ? "swatch line selected" : "swatch line"} aria-hidden="true" />{r.label}</li>
        ))}
      </ul>
      <TableView
        caption="Tested oxygen ranges per investigation"
        head={["Investigation", "Range", "Basis", "Runs with a value", "Source column"]}
        rows={withO2.flatMap((r) => r.conditions.o2.map((o) => [
          `${r.acronym || r.id} (${r.id})`, percentRange(o.min_percent, o.max_percent), basisLabels[o.basis], o.runs_with_value, o.source_column,
        ]))}
      />
    </>
  );
}

/** Experiment-table rows naming each fuel or material, ranked. */
export function FuelRuns({ totals, hrefFor, onClick, limit }: {
  totals: { fuel: string; runs: number; category: FuelCategory; investigations: number }[];
  hrefFor: (fuel: string) => string;
  onClick: Click;
  limit: number;
}) {
  const max = Math.max(1, ...totals.map((t) => t.runs));
  const shown = totals.slice(0, limit);
  const step = max > 300 ? 100 : 50;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
    .filter((v, i, all) => all.length <= 6 || i % 2 === 0 || v === top)
    .map((v) => ({ at: (v / top) * 100, label: v.toLocaleString("en-US") }));
  return (
    <>
      <div className="rowchart">
        <Axis ticks={ticks} />
        {shown.map((t) => (
          <a key={t.fuel} className="chart-row" href={hrefFor(t.fuel)} onClick={onClick}
            aria-label={`${t.fuel}: ${t.runs} rows in ${t.investigations} ${t.investigations === 1 ? "investigation" : "investigations"}. Open in the explorer.`}>
            <span className="row-label" title={t.fuel}>{t.fuel}</span>
            <span className="row-track"><span className="mark-bar" style={{ width: `${(t.runs / top) * 100}%` }} /></span>
            <span className="row-value">{t.runs.toLocaleString("en-US")}</span>
            <span className="tip" aria-hidden="true">
              <strong>{t.fuel}</strong>
              {categoryLabels[t.category]}, {t.runs} rows in {t.investigations} {t.investigations === 1 ? "investigation" : "investigations"}
            </span>
          </a>
        ))}
      </div>
      <TableView
        caption="Experiment-table rows per fuel or material"
        head={["Fuel or material", "Category", "Rows", "Investigations"]}
        rows={totals.map((t) => [t.fuel, categoryLabels[t.category], t.runs, t.investigations])}
      />
    </>
  );
}

/** Investigation periods on a shared year axis. */
export function Timeline({ records, hrefFor, onClick }: {
  records: Investigation[];
  hrefFor: (id: string) => string;
  onClick: Click;
}) {
  const dated = records.filter((r) => r.start_date).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  if (dated.length === 0) return <p className="o2-missing">PSI lists no dates for these investigations.</p>;
  const year = (d: string) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) - 1) / 12;
  const first = Math.floor(Math.min(...dated.map((r) => year(r.start_date!))) / 5) * 5;
  const last = Math.ceil(Math.max(...dated.map((r) => year(r.end_date ?? r.start_date!))) / 5) * 5;
  const at = (y: number) => ((y - first) / (last - first)) * 100;
  const ticks = Array.from({ length: (last - first) / 5 + 1 }, (_, i) => first + i * 5).map((y) => ({ at: at(y), label: String(y) }));
  const span = (r: Investigation) => {
    const s = r.start_date!.slice(0, 4);
    const e = r.end_date?.slice(0, 4);
    return e && e !== s ? `${s}–${e}` : e ? s : `from ${s}`;
  };
  return (
    <>
      <div className="rowchart">
        <Axis ticks={ticks} />
        {dated.map((r) => {
          const start = year(r.start_date!);
          const end = r.end_date ? year(r.end_date) : start;
          return (
            <a key={r.id} className="chart-row" href={hrefFor(r.id)} onClick={onClick}
              aria-label={`${r.acronym || r.id}: ${span(r)}. ${r.title}`}>
              <span className="row-label">{r.acronym || r.id}<small>{r.id}</small></span>
              <span className="row-track">
                <span className="bar-base" />
                <span className="mark-span" style={{ left: `${at(start)}%`, width: `${Math.max(0, at(end) - at(start))}%` }} />
              </span>
              <span className="row-value">{span(r)}</span>
              <span className="tip" aria-hidden="true"><strong>{r.title}</strong>{r.flight_program || "Ground investigation"}</span>
            </a>
          );
        })}
      </div>
      <TableView
        caption="Investigation periods"
        head={["Investigation", "Start", "End", "Flight program"]}
        rows={dated.map((r) => [`${r.acronym || r.id} (${r.id})`, r.start_date, r.end_date ?? "not listed", r.flight_program || "none"])}
      />
    </>
  );
}
