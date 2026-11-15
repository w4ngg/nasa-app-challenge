import { useState } from "react";
import type { ReactNode } from "react";
import type { ChartSpec } from "../lib/assistant";

// Charts for the research assistant. Every number comes from the NASA PSI experiment tables (computed by
// apps/assistant/assistant/charts.py), never from the language model. SVG, scales to its column.
// Palette: validated categorical slots for the dark surface (blue, orange, aqua) - dataviz validator, all checks pass.
const SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
const W = 640;

// x in viewBox units, y as a 0-1 fraction of the chart height (the SVG scales with its column)
type Tip = { x: number; y: number; lines: string[] } | null;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = v > 200 ? 100 : v > 50 ? 10 : v > 20 ? 5 : v > 10 ? 2 : 1;
  return Math.ceil(v / step) * step;
}

function ticks(max: number, count = 5): number[] {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(Math.round(n * 10) / 10));

function Legend({ spec }: { spec: ChartSpec }) {
  if (spec.series.length < 2) return null;
  return (
    <ul className="viz-legend" aria-label="Legend">
      {spec.series.map((s, i) => (
        <li key={s.key}><span className={`viz-swatch ${spec.type === "scatter" ? "dot" : ""}`} style={{ background: SLOTS[i] }} aria-hidden="true" />{s.label}</li>
      ))}
    </ul>
  );
}

function RangeChart({ spec, onTip }: { spec: ChartSpec; onTip: (t: Tip) => void }) {
  const rows = spec.rows ?? [];
  const refs = spec.reference_lines ?? [];
  const labelW = 170, right = 70, rowH = 26, top = 28, bottom = 34;
  const max = niceMax(Math.max(...rows.map((r) => r.max ?? 0), ...refs.map((r) => r.value)));
  const plotW = W - labelW - right;
  const x = (v: number) => labelW + (v / max) * plotW;
  const H = top + rows.length * rowH + bottom;
  const goal = refs.length ? Math.max(...refs.map((r) => r.value)) : null;
  const slot = (key: string) => SLOTS[Math.max(0, spec.series.findIndex((s) => s.key === key))];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title} className="viz-svg">
      {ticks(max).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - bottom} className="viz-grid" />
          <text x={x(t)} y={H - bottom + 16} textAnchor="middle" className="viz-tick">{fmt(t)}</text>
        </g>
      ))}
      <text x={labelW + plotW / 2} y={H - 4} textAnchor="middle" className="viz-axis-label">{spec.x_label}</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2;
        const lit = goal === null || (r.max ?? 0) >= goal;
        const x1 = x(r.min ?? 0), x2 = Math.max(x(r.max ?? 0), x1 + 8);
        const lines = [`${r.label}`, `${spec.series.find((s) => s.key === r.series)?.label ?? r.series}`,
          `${fmt(r.min ?? 0)}% to ${fmt(r.max ?? 0)}% oxygen`, r.n ? `${r.n} runs with a recorded value` : ""].filter(Boolean);
        const prev = rows[i - 1];
        return (
          <g key={`${r.label}-${r.series}`} className="viz-mark" tabIndex={0}
            onMouseEnter={() => onTip({ x: x2, y: y / H, lines })} onFocus={() => onTip({ x: x2, y: y / H, lines })}
            onMouseLeave={() => onTip(null)} onBlur={() => onTip(null)}>
            <rect x={labelW - 4} y={y - rowH / 2} width={plotW + right} height={rowH} fill="transparent" />
            {(!prev || prev.label !== r.label) && <text x={labelW - 10} y={y + 4} textAnchor="end" className={`viz-label ${lit ? "" : "dim"}`}>{r.label}</text>}
            <rect x={x1} y={y - 6} width={x2 - x1} height={12} rx={4} fill={slot(r.series ?? "")} opacity={lit ? 1 : 0.32} />
            {lit && <text x={x2 + 6} y={y + 4} className="viz-value">{fmt(r.min ?? 0)}–{fmt(r.max ?? 0)}%</text>}
          </g>
        );
      })}
      {[...refs].sort((a, b) => a.value - b.value).map((r, i, all) => {
        // two lines sit close together (20.9% and 30%): the lower label goes left of its line, the higher one right
        const leftSide = all.length > 1 && i < all.length - 1;
        return (
          <g key={r.label} className="viz-ref">
            <line x1={x(r.value)} x2={x(r.value)} y1={top - 10} y2={H - bottom} />
            <text x={x(r.value) + (leftSide ? -5 : 5)} y={top - 14} textAnchor={leftSide ? "end" : "start"}>{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ spec, onTip }: { spec: ChartSpec; onTip: (t: Tip) => void }) {
  const rows = spec.rows ?? [];
  const labelW = 170, right = 60, rowH = 26, top = 8, bottom = 34;
  const max = niceMax(Math.max(...rows.map((r) => r.value ?? 0)));
  const plotW = W - labelW - right;
  const x = (v: number) => labelW + (v / max) * plotW;
  const H = top + rows.length * rowH + bottom;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title} className="viz-svg">
      {ticks(max).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={H - bottom} className="viz-grid" />
          <text x={x(t)} y={H - bottom + 16} textAnchor="middle" className="viz-tick">{fmt(t)}</text>
        </g>
      ))}
      <text x={labelW + plotW / 2} y={H - 4} textAnchor="middle" className="viz-axis-label">{spec.x_label}</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2;
        const w = Math.max(2, x(r.value ?? 0) - labelW);
        const lines = [r.label, `${fmt(r.value ?? 0)} ${spec.unit}`];
        return (
          <g key={r.label} className="viz-mark" tabIndex={0}
            onMouseEnter={() => onTip({ x: labelW + w, y: y / H, lines })} onFocus={() => onTip({ x: labelW + w, y: y / H, lines })}
            onMouseLeave={() => onTip(null)} onBlur={() => onTip(null)}>
            <rect x={labelW - 4} y={y - rowH / 2} width={plotW + right} height={rowH} fill="transparent" />
            <text x={labelW - 10} y={y + 4} textAnchor="end" className="viz-label">{r.label}</text>
            {/* square at the baseline, 4px rounded data end */}
            <path d={`M${labelW},${y - 7} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v6 a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} z`} fill={SLOTS[0]} />
            <text x={labelW + w + 6} y={y + 4} className="viz-value">{fmt(r.value ?? 0)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ScatterChart({ spec, onTip }: { spec: ChartSpec; onTip: (t: Tip) => void }) {
  const pts = spec.points ?? [];
  const left = 48, right = 16, top = 22, bottom = 40, H = 340;
  const xs = pts.map((p) => p.x);
  const x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1);
  const yMax = niceMax(Math.max(...pts.map((p) => p.y)));
  const plotW = W - left - right, plotH = H - top - bottom;
  const X = (v: number) => left + ((v - x0) / (x1 - x0)) * plotW;
  const Y = (v: number) => top + plotH - (v / yMax) * plotH;
  const slot = (key: string) => SLOTS[Math.max(0, spec.series.findIndex((s) => s.key === key))];
  const label = (key: string) => spec.series.find((s) => s.key === key)?.label ?? key;
  const xTicks: number[] = [];
  for (let t = Math.ceil(x0 / 5) * 5; t <= x1; t += 5) xTicks.push(t);  // round oxygen percentages: 15, 20, 25…
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title} className="viz-svg">
      {ticks(yMax).map((t) => (
        <g key={`y${t}`}>
          <line x1={left} x2={W - right} y1={Y(t)} y2={Y(t)} className="viz-grid" />
          <text x={left - 8} y={Y(t) + 4} textAnchor="end" className="viz-tick">{fmt(t)}</text>
        </g>
      ))}
      {xTicks.map((t) => <text key={`x${t}`} x={X(t)} y={H - bottom + 16} textAnchor="middle" className="viz-tick">{fmt(t)}</text>)}
      <text x={left + plotW / 2} y={H - 4} textAnchor="middle" className="viz-axis-label">{spec.x_label}</text>
      <text x={12} y={top + plotH / 2} textAnchor="middle" transform={`rotate(-90 12 ${top + plotH / 2})`} className="viz-axis-label">{spec.y_label}</text>
      {(spec.reference_lines ?? []).map((r) => (
        <g key={r.label} className="viz-ref">
          <line x1={X(r.value)} x2={X(r.value)} y1={top} y2={top + plotH} />
          <text x={X(r.value) + 4} y={top + 10}>{r.label}</text>
        </g>
      ))}
      {pts.map((p, i) => {
        const lines = [`${label(p.series)} droplet${p.test ? `, test ${p.test}` : ""}`, `${fmt(p.x)}% oxygen`, `Burned ${fmt(p.y)} s`, p.end ? `Test ended by ${p.end.toLowerCase()}` : ""].filter(Boolean);
        return (
          <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4} fill={slot(p.series)} className="viz-dot" tabIndex={0}
            onMouseEnter={() => onTip({ x: X(p.x), y: Y(p.y) / H, lines })} onFocus={() => onTip({ x: X(p.x), y: Y(p.y) / H, lines })}
            onMouseLeave={() => onTip(null)} onBlur={() => onTip(null)} />
        );
      })}
      {(spec.lines ?? []).map((l) => (
        <g key={l.series}>
          <polyline points={l.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} fill="none" stroke={slot(l.series)} strokeWidth={2.5}
            strokeLinejoin="round" strokeLinecap="round" className="viz-median" />
          {l.points.length > 0 && (() => {
            const last = l.points[l.points.length - 1];
            return <text x={Math.min(X(last.x) + 6, W - right - 4)} y={Y(last.y) - 8} textAnchor="end" className="viz-value">{label(l.series)} median</text>;
          })()}
        </g>
      ))}
    </svg>
  );
}

function DataTable({ spec }: { spec: ChartSpec }) {
  let head: string[] = [], body: ReactNode[][] = [];
  if (spec.type === "range") {
    head = ["Experiment", "Where oxygen was measured", "Lowest %", "Highest %", "Runs"];
    body = (spec.rows ?? []).map((r) => [r.label, spec.series.find((s) => s.key === r.series)?.label ?? r.series, fmt(r.min ?? 0), fmt(r.max ?? 0), r.n ?? "–"]);
  } else if (spec.type === "bar") {
    head = ["Item", spec.x_label ?? "Value"];
    body = (spec.rows ?? []).map((r) => [r.label, fmt(r.value ?? 0)]);
  } else {
    head = ["Fuel", "Oxygen %", "Median burn time (s)", "Tests"];
    body = (spec.lines ?? []).flatMap((l) => l.points.map((p) => [spec.series.find((s) => s.key === l.series)?.label ?? l.series, fmt(p.x), fmt(p.y), p.n]));
  }
  return (
    <details className="viz-table">
      <summary>Show the numbers as a table</summary>
      <div className="table-scroll">
        <table>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const [tip, setTip] = useState<Tip>(null);
  const Chart = spec.type === "range" ? RangeChart : spec.type === "bar" ? BarChart : ScatterChart;
  const goal = spec.type === "range" && spec.reference_lines?.length ? Math.max(...spec.reference_lines.map((r) => r.value)) : null;
  return (
    <figure className="viz">
      <figcaption>
        <strong>{spec.title}</strong>
        {spec.subtitle && <span>{spec.subtitle}</span>}
        {goal !== null && <span className="viz-hint">Bright bars reach the {goal}% line; faded bars stay below it.</span>}
      </figcaption>
      <Legend spec={spec} />
      <div className="viz-plot">
        <Chart spec={spec} onTip={setTip} />
        {tip && (
          <div className="viz-tip" role="status" style={{ left: `${(tip.x / W) * 100}%`, top: `${tip.y * 100}%` }}>
            {tip.lines.map((l, i) => <div key={i} className={i === 0 ? "viz-tip-title" : ""}>{l}</div>)}
          </div>
        )}
      </div>
      {spec.notes && spec.notes.length > 0 && <ul className="viz-notes">{spec.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="viz-source">Source: {spec.source}</p>
      <DataTable spec={spec} />
    </figure>
  );
}
