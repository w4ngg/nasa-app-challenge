import { useState } from "react";
import { displayNumber } from "../lib/analytics";
import type { BassGas, BassResult } from "../lib/bass";

export function BassFlowEvidence({ result, testId }: { result: BassResult; testId: string }) {
  const [active, setActive] = useState<number | null>(null);
  const pairs = result.flow_spread_pairs;
  const available = pairs.filter((p) => p.spread_rate_mm_s !== null);
  const maxX = Math.max(1, ...pairs.map((p) => p.airflow_cm_s)) * 1.1;
  const maxY = Math.max(.001, ...available.map((p) => p.spread_rate_mm_s!)) * 1.15;
  const x = (v: number) => 72 + v / maxX * 414;
  const y = (v: number) => 196 - v / maxY * 168;
  const selected = active === null ? null : pairs[active];
  const ticks = [0, 1, 2, 3, 4];
  return <div className="bass-evidence">
    <p className="field-help">Source-listed airflow/rate pairs within test {testId}. Points are settings from one experiment, not independent tests or time samples.</p>
    {available.length ? <figure className="bass-chart">
      <svg viewBox="0 0 520 254" role="group" aria-label={`Reported spread rate against airflow for BASS-II ${testId}. Select a point for the source values.`}>
        <title>Reported spread rate against airflow</title>
        {ticks.map((i) => <g key={i} aria-hidden="true"><line x1="72" x2="486" y1={y(maxY * i / 4)} y2={y(maxY * i / 4)} className="analytics-gridline" /><text x="62" y={y(maxY * i / 4) + 4} textAnchor="end">{displayNumber(Number((maxY * i / 4).toPrecision(3)))}</text><text x={x(maxX * i / 4)} y="215" textAnchor="middle">{displayNumber(Number((maxX * i / 4).toPrecision(3)))}</text></g>)}
        <line x1="72" x2="486" y1="196" y2="196" className="analytics-axis" /><line x1="72" x2="72" y1="28" y2="196" className="analytics-axis" />
        <text x="279" y="245" textAnchor="middle">Airflow (cm/s)</text><text transform="translate(16,112) rotate(-90)" textAnchor="middle">Spread rate (mm/s)</text>
        {pairs.map((p, i) => p.spread_rate_mm_s === null ? null : <g key={i} role="button" tabIndex={0} className="bass-chart-point"
          aria-label={`${p.airflow_cm_s} cm/s airflow, ${p.spread_rate_mm_s} mm/s spread rate, source setting ${i + 1}`} aria-pressed={active === i}
          transform={`translate(${x(p.airflow_cm_s)},${y(p.spread_rate_mm_s)})`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(i); } }}>
          <circle r="12" className="analytics-hit" /><circle r="5" className="bass-chart-mark" />{active === i && <circle r="10" className="analytics-selected-ring" />}
        </g>)}
      </svg>
      <figcaption className="analytics-point-readout" aria-live="polite">{selected ? `${selected.airflow_cm_s} cm/s → ${selected.spread_rate_mm_s} mm/s · Table 5.1, test ${testId}` : "Hover, focus or select a point to inspect the reported pair. No fitted relationship is added."}</figcaption>
    </figure> : <p className="flex-evidence-unavailable">NASA records the spread rate as “Not tracked”. No zero-valued points are plotted.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${testId} source airflow and spread-rate pairs`}><table>
      <thead><tr><th scope="col">Source setting</th><th scope="col">Airflow (cm/s)</th><th scope="col">Spread rate (mm/s)</th></tr></thead>
      <tbody>{pairs.map((p, i) => <tr key={i} className={active === i ? "analytics-row-selected" : undefined}><th scope="row">{i + 1}</th><td>{displayNumber(p.airflow_cm_s)}</td><td>{p.spread_rate_mm_s === null ? "Not tracked" : displayNumber(p.spread_rate_mm_s)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

export function BassGasEvidence({ gases }: { gases: BassGas[] }) {
  const [key, setKey] = useState<BassGas["key"]>("o2");
  const [active, setActive] = useState<string | null>(null);
  const gas = gases.find((g) => g.key === key)!;
  const points = [{ label: "Before", reading: gas.initial }, { label: "After", reading: gas.final }];
  const max = Math.max(1, ...points.map((p) => p.reading.value ?? 0)) * 1.1;
  return <div className="bass-evidence">
    <label className="analytics-field">Gas quantity<select value={key} onChange={(event) => { setKey(event.target.value as BassGas["key"]); setActive(null); }}>{gases.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.unit})</option>)}</select></label>
    {points.some((p) => p.reading.value !== null) ? <figure className="bass-chart">
      <svg viewBox="0 0 520 174" role="group" aria-label={`${gas.label} before and after the test in ${gas.unit}. Bars start at zero.`}>
        <title>{gas.label}: before and after test</title>
        {[0, 1, 2, 3, 4].map((i) => <g key={i} aria-hidden="true"><line x1={90 + i / 4 * 380} x2={90 + i / 4 * 380} y1="20" y2="125" className="analytics-gridline" /><text x={90 + i / 4 * 380} y="146" textAnchor="middle">{displayNumber(Number((max * i / 4).toPrecision(3)))}</text></g>)}
        {points.map((p, i) => <g key={p.label}>
          <text x="78" y={44 + i * 55} textAnchor="end">{p.label}</text>
          {p.reading.value === null ? <text x="100" y={44 + i * 55}>No exact numeric reading</text> : <g role="button" tabIndex={0} className="bass-chart-point"
            aria-label={`${p.label}: ${displayNumber(p.reading.value)} ${gas.unit}`} onMouseEnter={() => setActive(p.label)} onFocus={() => setActive(p.label)} onClick={() => setActive(p.label)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(p.label); } }}>
            <rect x="90" y={24 + i * 55} width="380" height="30" className="analytics-hit" />
            <rect x="90" y={24 + i * 55} width={p.reading.value / max * 380} height="30" className="bass-chart-mark" />
          </g>}
        </g>)}
        <text x="280" y="169" textAnchor="middle">{gas.label} ({gas.unit}) · zero baseline</text>
      </svg>
      <figcaption className="analytics-point-readout" aria-live="polite">{active ? `${active}: ${points.find((p) => p.label === active)!.reading.raw} ${gas.unit} · source catalog reading` : "Only the before/after readings are shown. No continuous profile or intermediate values are inferred."}</figcaption>
    </figure> : <p className="flex-evidence-unavailable">No exact numeric readings are available for this gas. Original source cells remain below.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Original before and after gas readings"><table className="analytics-table">
      <thead><tr><th scope="col">Quantity</th><th scope="col">Before (source)</th><th scope="col">After (source)</th></tr></thead>
      <tbody>{gases.map((g) => <tr key={g.key}><th scope="row">{g.label} ({g.unit})</th>{[g.initial, g.final].map((c, i) => <td key={i}>{c.raw || "Empty source cell"}{c.issue && <small>{c.issue}</small>}</td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}
