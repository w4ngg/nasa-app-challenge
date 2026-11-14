import { useState } from "react";
import { displayNumber, metricLabel } from "../lib/analytics";
import type { AnalyticsRow, Metric } from "../lib/analytics";

const colors = ["#0f62fe", "#393939", "#0043ce", "#6f6f6f", "#002d9c", "#161616"];
const symbols = ["M-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0", "M-5,-5 h10 v10 h-10 Z", "M0,-7 L6,0 L0,7 L-6,0 Z", "M0,-7 L6,5 L-6,5 Z", "M-6,-2 H-2 V-6 H2 V-2 H6 V2 H2 V6 H-2 V2 H-6 Z", "M-6,-5 L6,5 M-6,5 L6,-5"];

export function rowGroup(row: AnalyticsRow, group: string): string {
  return group === "material" ? row.material : group ? row.categories[group] : "All rows";
}

function domain(values: number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || Math.abs(low) || 1) * .08;
  return [Math.max(0, low - pad), high + pad];
}

export function AnalyticsScatter({ rows, x, y, group, selected, onSelect, selectionHint = "Select a point to inspect its complete source row below." }: {
  rows: AnalyticsRow[]; x: Metric; y: Metric; group: string;
  selected: number | null; onSelect: (row: AnalyticsRow) => void;
  selectionHint?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const groups = [...new Set(rows.map((r) => rowGroup(r, group)))].sort();
  const current = rows.find((r) => r.key === active) ?? rows.find((r) => r.key === selected);
  if (!rows.length) return <div className="state analytics-empty"><h3>No points to plot</h3><p>Choose another pair of measured quantities or widen the filters. Rows without exact numeric values remain available in the table.</p></div>;
  const [x0, x1] = domain(rows.map((r) => r.cells[x.key].value!));
  const [y0, y1] = domain(rows.map((r) => r.cells[y.key].value!));
  const px = (value: number) => 88 + (value - x0) / (x1 - x0) * 742;
  const py = (value: number) => 332 - (value - y0) / (y1 - y0) * 298;
  const ticks = (low: number, high: number) => Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4);
  return (
    <figure className="analytics-figure">
      <svg viewBox="0 0 860 400" className="analytics-scatter" role="group" aria-label={`${metricLabel(y)} against ${metricLabel(x)}. ${rows.length} recorded points. ${selectionHint}`}>
        <title>{`${y.label} against ${x.label}`}</title>
        <desc>Observed measurements only. Point shapes identify groups. Each point has a keyboard-accessible source readout; the same values are available in the measurements table.</desc>
        {ticks(y0, y1).map((v) => <g key={v} aria-hidden="true"><line x1="88" x2="830" y1={py(v)} y2={py(v)} className="analytics-gridline" /><text x="76" y={py(v) + 4} textAnchor="end">{displayNumber(Number(v.toPrecision(3)))}</text></g>)}
        {ticks(x0, x1).map((v) => <g key={v} aria-hidden="true"><line x1={px(v)} x2={px(v)} y1="34" y2="332" className="analytics-gridline" /><text x={px(v)} y="354" textAnchor="middle">{displayNumber(Number(v.toPrecision(3)))}</text></g>)}
        <line x1="88" x2="830" y1="332" y2="332" className="analytics-axis" />
        <line x1="88" x2="88" y1="34" y2="332" className="analytics-axis" />
        <text x="459" y="389" textAnchor="middle" className="analytics-axis-label">{metricLabel(x)}</text>
        <text transform="translate(18,183) rotate(-90)" textAnchor="middle" className="analytics-axis-label">{metricLabel(y)}</text>
        {rows.map((row) => {
          const index = groups.indexOf(rowGroup(row, group)) % symbols.length;
          const readout = `Test ${row.testId}, ${row.material}. ${x.label}: ${displayNumber(row.cells[x.key].value)} ${x.unit}. ${y.label}: ${displayNumber(row.cells[y.key].value)} ${y.unit}. ${rowGroup(row, group)}.`;
          return (
            <g key={row.key} transform={`translate(${px(row.cells[x.key].value!)},${py(row.cells[y.key].value!)})`}
              className={`analytics-point${selected === row.key ? " selected" : ""}`} role="button" tabIndex={0}
              aria-label={readout} aria-pressed={selected === row.key}
              onMouseEnter={() => setActive(row.key)} onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(row.key)} onBlur={() => setActive(null)}
              onClick={() => onSelect(row)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row); }
              }}>
              <title>{readout}</title>
              <circle r="11" className="analytics-hit" />
              <path d={symbols[index]} fill={colors[index]} stroke={colors[index]} strokeWidth="1.5" pointerEvents="none" />
              {selected === row.key && <circle r="10" className="analytics-selected-ring" pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="analytics-legend" aria-label="Point groups">{groups.map((g, i) => <li key={g}><svg viewBox="-10 -10 20 20" aria-hidden="true"><path d={symbols[i % symbols.length]} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} strokeWidth="1.5" /></svg>{g} <span>({rows.filter((r) => rowGroup(r, group) === g).length})</span></li>)}</ul>
        <p className="analytics-point-readout">{current
          ? <><strong>Test {current.testId}</strong> · {current.material} · {displayNumber(current.cells[x.key].value)} {x.unit} / {displayNumber(current.cells[y.key].value)} {y.unit} · {rowGroup(current, group)}</>
          : `Hover or focus a point for its values. ${selectionHint}`}</p>
      </figcaption>
    </figure>
  );
}
