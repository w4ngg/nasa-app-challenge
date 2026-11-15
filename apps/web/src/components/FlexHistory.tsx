import { useId, useState } from "react";
import { displayNumber } from "../lib/analytics";
import { historySegments } from "../lib/flex";
import type { FlexHistory as History, FlexSeries } from "../lib/flex";

type Channel = { key: string; label: string; color: string; series: FlexSeries };

export function FlexHistory({ history }: { history: History }) {
  const [squared, setSquared] = useState(false);
  const [full, setFull] = useState(false);
  const [channelKey, setChannelKey] = useState("droplet");
  const [page, setPage] = useState(0);
  const channels: Channel[] = [
    { key: "droplet", label: "Droplet · HiBMS", color: "#0f62fe", series: history.series.droplet! },
    { key: "lluv", label: "Flame · LLUV", color: "#393939", series: history.series.lluv! },
    { key: "color", label: "Flame · color camera", color: "#0043ce", series: history.series.color! },
  ].filter((c) => c.series && c.series.points.some((p) => p[1] !== null));
  const end = full ? null : history.display_end_s;
  const times = channels.flatMap((c) => historySegments(c.series, end).flat().map((p) => p[0]));
  const maxTime = Math.max(1, ...times);
  const droplet = channels.filter((c) => c.key === "droplet");
  const flames = channels.filter((c) => c.key !== "droplet");
  const channel = channels.find((c) => c.key === channelKey) ?? channels[0];
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil((channel?.series.points.length ?? 0) / pageSize));
  const safePage = Math.min(page, pageCount - 1);

  if (!channels.length || !times.length) return <p className="field-help">The available source files do not contain plottable time/diameter pairs at or after ignition.</p>;
  return <div className="flex-history">
    <p className="field-help">Image-derived measurements. Time zero is when the igniters were switched on. Dashed markers show the catalog’s recorded burn time.</p>
    {droplet.length > 0 && <>
      <div className="segmented flex-history-switch" aria-label="Droplet quantity">
        <button aria-pressed={!squared} onClick={() => setSquared(false)}>Diameter</button>
        <button aria-pressed={squared} onClick={() => setSquared(true)}>Diameter squared</button>
      </div>
      <HistoryPlot channels={droplet} maxTime={maxTime} end={end} marker={history.recorded_endpoint_s}
        squared={squared} label={squared ? "Droplet D² (mm²)" : "Droplet diameter (mm)"} />
    </>}
    {flames.length > 0 && <HistoryPlot channels={flames} maxTime={maxTime} end={end}
      marker={history.recorded_endpoint_s} squared={false} label="Flame diameter (mm)" />}
    <ul className="flex-history-legend">{channels.map((c) => <li key={c.key}><span style={{ background: c.color }} />{c.label}</li>)}</ul>
    <p className="field-help">Lines stop at the recorded limits and break at missing readings or timing gaps. The two flame cameras measure different optical signals.</p>
    {history.display_end_s !== null && <div className="flex-history-crop">
      <p>Late diameter jumps need image review. The initial view ends at {history.display_end_s} s.</p>
      <button className="link-button" aria-pressed={full} onClick={() => setFull((v) => !v)}>{full ? "Use the reviewed display range" : "Show the complete recorded series"}</button>
    </div>}
    {history.fits.map((fit) => <div className="flex-calculation" key={fit.window_s.join("-")}>
      <h4>Calculated from droplet measurements</h4>
      <p>K = −d(D²)/dt ≈ <strong>{displayNumber(Number(fit.k_mm2_s.toPrecision(4)))} mm²/s</strong> over {fit.window_s.join("–")} s.</p>
      <p className="field-help">{fit.points} time samples within this test · linear least-squares fit{fit.r_squared !== null && ` · R² ${fit.r_squared.toFixed(4)}`}. This describes the selected interval; it does not independently identify a combustion mechanism.</p>
    </div>)}
    <details className="flex-measurements">
      <summary>Inspect recorded measurements</summary>
      <label className="analytics-field">Measurement channel<select value={channel.key} onChange={(event) => { setChannelKey(event.target.value); setPage(0); }}>{channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${channel.label} recorded measurements`}>
        <table><thead><tr><th scope="col">Time (s)</th><th scope="col">Diameter (mm)</th></tr></thead><tbody>
          {channel.series.points.slice(safePage * pageSize, (safePage + 1) * pageSize).map(([t, d], i) => <tr key={`${i}-${t}`}><td>{displayNumber(t)}</td><td>{d === null ? "Unavailable source value" : displayNumber(d)}</td></tr>)}
        </tbody></table>
      </div>
      <div className="pagination"><span>{channel.series.points.length} time samples</span><div><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button><span>{safePage + 1}/{pageCount}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button></div></div>
    </details>
  </div>;
}

function HistoryPlot({ channels, maxTime, end, marker, squared, label }: {
  channels: Channel[]; maxTime: number; end: number | null; marker: number | null; squared: boolean; label: string;
}) {
  const titleId = useId();
  const readoutId = useId();
  const [cursor, setCursor] = useState<number | null>(null);
  const prepared = channels.map((c) => ({ ...c, segments: historySegments(c.series, end) }));
  const samples = prepared.flatMap((c) => c.segments.flat().map(([t, d]) => ({ t, d, label: c.label, color: c.color }))).sort((a, b) => a.t-b.t);
  const active = cursor !== null ? samples[Math.min(cursor, samples.length - 1)] : null;
  const values = prepared.flatMap((c) => c.segments.flat().map(([, d]) => squared ? d*d : d));
  const maxValue = Math.max(1, ...values) * 1.08;
  const px = (t: number) => 60 + t / maxTime * 418;
  const py = (d: number) => 180 - (squared ? d*d : d) / maxValue * 162;
  return <figure className="flex-history-figure"><svg className="flex-history-chart" viewBox="0 0 500 240" role="group" tabIndex={0} aria-labelledby={titleId} aria-describedby={readoutId}
    onFocus={() => setCursor(0)} onBlur={() => setCursor(null)} onPointerLeave={() => setCursor(null)}
    onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const target = ((event.clientX-rect.left)/rect.width*500-60)/418*maxTime;
      if (samples.length) setCursor(samples.reduce((best, sample, i) => Math.abs(sample.t-target) < Math.abs(samples[best].t-target) ? i : best, 0));
    }} onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setCursor((value) => Math.min(samples.length - 1, Math.max(0, (value ?? 0) + (event.key === "ArrowLeft" ? -1 : 1))));
      }
    }}>
    <title id={titleId}>{`${label} against time. Use left and right arrow keys to inspect measurements.`}</title>
    {[0, .25, .5, .75, 1].map((f) => <g key={f} aria-hidden="true"><line x1="60" x2="478" y1={180-f*162} y2={180-f*162} className="analytics-gridline" /><text x="50" y={184-f*162} textAnchor="end">{displayNumber(Number((maxValue*f).toPrecision(3)))}</text><text x={px(maxTime*f)} y="202" textAnchor="middle">{displayNumber(Number((maxTime*f).toPrecision(3)))}</text></g>)}
    <line x1="60" x2="478" y1="180" y2="180" className="analytics-axis" />
    {marker !== null && marker >= 0 && marker <= maxTime && <g><line x1={px(marker)} x2={px(marker)} y1="18" y2="180" stroke="#6f6f6f" strokeDasharray="4 4" /><title>{`Recorded burn time: ${marker} s (catalog)`}</title></g>}
    {prepared.map((c) => <g key={c.key}>{c.segments.map((segment, i) => segment.length === 1
      ? <circle key={i} cx={px(segment[0][0])} cy={py(segment[0][1])} r="2" fill={c.color} />
      : <path key={i} d={segment.map(([t, d], j) => `${j === 0 ? "M" : "L"}${px(t).toFixed(2)},${py(d).toFixed(2)}`).join(" ")} stroke={c.color} fill="none" strokeWidth="1.8" strokeDasharray={c.key === "lluv" ? "5 2" : undefined} />)}</g>)}
    {active && <g aria-hidden="true"><line x1={px(active.t)} x2={px(active.t)} y1="18" y2="180" stroke="#c6c6c6" /><circle cx={px(active.t)} cy={py(active.d)} r="4" fill="white" stroke={active.color} strokeWidth="2" /></g>}
    <text x="270" y="229" textAnchor="middle">Time after igniters on (s)</text>
    <text transform="translate(16,100) rotate(-90)" textAnchor="middle">{label}</text>
  </svg><figcaption id={readoutId} className="flex-history-readout" aria-live="polite">{active
    ? `${active.label} · ${displayNumber(active.t)} s · ${displayNumber(squared ? active.d*active.d : active.d)} ${squared ? "mm²" : "mm"}`
    : "Hover over the chart, or focus it and use the arrow keys, to inspect recorded values."}</figcaption></figure>;
}
