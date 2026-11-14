import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { FuelRuns, OxygenCoverage, Timeline } from "../components/charts";
import { EmberMascot } from "../components/EmberMascot";
import { Flame3D } from "../components/Flame3D";
import { ChamberSvg, RocketSvg, SatelliteSvg, ShieldSvg } from "../components/SpaceObjects";
import { Zone3PhaseMap } from "../components/Zone3PhaseMap";
import { getAllInvestigations } from "../lib/data";
import { emptyFilters } from "../lib/filters";
import { percentRange } from "../lib/labels";
import { missions } from "../lib/missions";
import { explorerUrl, routeUrl, viewUrl } from "../lib/route";
import type { FuelCategory, Investigation, Summary } from "../types";

const detailUrl = (id: string) => routeUrl({ view: "overview", id, filters: emptyFilters, page: 0 });
const name = (r: Investigation) => r.acronym || r.id;
const FUELS_SHOWN = 8;

const NEAR = 1; // percentage points

function spans(r: Investigation, level: number, basis: "ambient" | "oxidizer_stream") {
  return r.conditions.o2.some((o) => o.basis === basis && o.min_percent <= level && level <= o.max_percent);
}

/** A recorded run within NEAR points of the level, not just a range around it. */
function near(r: Investigation, level: number, basis: "ambient" | "oxidizer_stream") {
  return r.conditions.o2.some((o) => o.basis === basis && o.values.some((v) => Math.abs(v - level) <= NEAR));
}

function PanelHead({ num, id, title }: { num: number; id: string; title: string }) {
  return <div className="panel-head"><span className="panel-num" aria-hidden="true">{num}</span><h2 id={id}>{title}</h2></div>;
}

export function OverviewPage({ summary, onLink }: {
  summary: Summary | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [records, setRecords] = useState<Investigation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState(34);
  const [gravity, setGravity] = useState(0.0);
  const [showAllFuels, setShowAllFuels] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getAllInvestigations().then((r) => { if (!cancelled) setRecords(r); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  const stats = useMemo(() => {
    if (!records) return null;
    const fuelTotals = new Map<string, { fuel: string; runs: number; category: FuelCategory; investigations: number }>();
    for (const r of records) {
      for (const [fuel, runs] of Object.entries(r.conditions.fuel_runs)) {
        const entry = fuelTotals.get(fuel) ?? { fuel, runs: 0, category: r.conditions.fuel_groups[fuel], investigations: 0 };
        entry.runs += runs;
        entry.investigations += 1;
        fuelTotals.set(fuel, entry);
      }
    }
    const solidAmbient = records.flatMap((r) => r.conditions.fuel_categories.includes("solid")
      ? r.conditions.o2.filter((o) => o.basis === "ambient").map((o) => ({ r, max: o.max_percent })) : []);
    const topSolid = solidAmbient.sort((a, b) => b.max - a.max)[0] ?? null;
    const count = (p: string) => records.filter((r) => r.platform === p).length;
    const noTable = records.filter((r) => r.conditions.run_count === 0);
    return {
      fuels: [...fuelTotals.values()].sort((a, b) => b.runs - a.runs || a.fuel.localeCompare(b.fuel)),
      rows: records.reduce((sum, r) => sum + r.conditions.run_count, 0),
      topSolid,
      platforms: { iss: count("iss"), cygnus: count("cygnus"), ground: count("ground") },
      noO2: records.filter((r) => r.conditions.o2.length === 0),
      noTable,
      noTableAllGround: noTable.every((r) => r.platform === "ground"),
    };
  }, [records]);

  if (failed) {
    return (
      <div className="state" role="alert">
        <h1 className="state-title">The catalog could not be loaded</h1>
        <p>Check your connection and try again.</p>
        <button type="button" onClick={() => setAttempt((v) => v + 1)}>Try again</button>
      </div>
    );
  }
  if (!records || !stats) return <p className="state" role="status">Loading the catalog…</p>;
  if (records.length === 0) {
    return <div className="state" role="status"><h1 className="state-title">The catalog is empty</h1><p>Run the PSI import and static export described in the README.</p></div>;
  }

  const mission = missions.find((m) => m.o2 === level) ?? null;
  const ambient = records.filter((r) => spans(r, level, "ambient"));
  const ambientNear = ambient.filter((r) => near(r, level, "ambient"));
  const ambientRangeOnly = ambient.filter((r) => !ambientNear.includes(r));
  const burner = records.filter((r) => spans(r, level, "oxidizer_stream") && !ambient.includes(r));
  const solids = ambient.filter((r) => r.conditions.fuel_categories.includes("solid"));
  const solidsNear = solids.filter((r) => ambientNear.includes(r));
  const references = [
    { value: 21, label: "21%: Earth air (ISS cabin)", selected: level === 21 },
    { value: 34, label: "34%: proposed exploration atmosphere", selected: level === 34 },
    ...(level !== 21 && level !== 34 ? [{ value: level, label: `${level}%: selected level`, selected: true }] : []),
  ];
  const list = (items: Investigation[]) => items.map((r, i) => (
    <span key={r.id}>{i > 0 && ", "}<a href={detailUrl(r.id)} onClick={onLink}>{name(r)}</a></span>
  ));

  return (
    <div className="page">
      <header className="page-header">
        <h1>What NASA has tested, and where the evidence stops</h1>
        <p>
          {records.length} Combustion Science investigations from NASA PSI, {stats.rows.toLocaleString("en-US")} experiment-table
          rows and {summary?.publications ?? "their"} linked publications.
          {summary?.retrieved_at && ` Retrieved ${new Date(summary.retrieved_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}.`}
        </p>
      </header>

      <div className="chamber-grid">
        <Flame3D gravity={gravity} o2={level} fuelName={mission ? `${mission.name} (${level}% O₂)` : `Custom (${level}% O₂)`} />
        <div style={{ display: "grid", gap: 16 }}>
          <section className="panel" aria-label="3D Gravity & Telemetry Controls">
            <div className="level-control" style={{ marginBottom: 8 }}>
              <label htmlFor="hero-g-level">Gravity (0g–1g)</label>
              <input
                id="hero-g-level"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={gravity}
                onChange={(e) => setGravity(Number(e.target.value))}
              />
              <output className="level-value" htmlFor="hero-g-level">{gravity.toFixed(2)}g</output>
            </div>
            <div className="segmented" role="group" aria-label="Gravity presets">
              {[
                { label: "0.00g ISS", g: 0.0 },
                { label: "0.17g Moon", g: 0.17 },
                { label: "0.38g Mars", g: 0.38 },
                { label: "1.00g Earth", g: 1.0 },
              ].map((p) => (
                <button key={p.label} type="button" aria-pressed={Math.abs(gravity - p.g) < 0.02} onClick={() => setGravity(p.g)}>
                  {p.label}
                </button>
              ))}
            </div>
          </section>
          <EmberMascot gravity={gravity} o2={level} />
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="missions-title">
          <PanelHead num={1} id="missions-title" title="Mission atmospheres" />
          <p className="panel-lede">Pick a cabin atmosphere or set any oxygen level. The 3D Flame Chamber and coverage map follow your choice.</p>
          <div className="missions" role="group" aria-label="Mission atmospheres">
            {missions.map((m) => (
              <button key={m.id} type="button" className="mission" aria-pressed={level === m.o2} onClick={() => setLevel(m.o2)}>
                <span className="mission-name">{m.name}</span>
                <span className="mission-atm"><strong>{m.o2}% O₂</strong> at {m.pressure}</span>
                <span className="mission-note">{m.note}</span>
              </button>
            ))}
          </div>
          <div className="level-control">
            <label htmlFor="o2-level">Oxygen level</label>
            <input id="o2-level" type="range" min={0} max={100} step={1} value={level}
              aria-valuetext={`${level}% oxygen${mission ? `, ${mission.name}` : ""}`}
              onChange={(e) => setLevel(Number(e.target.value))} />
            <output className="level-value" htmlFor="o2-level">{level}%</output>
          </div>
          <div className="readout" aria-live="polite">
            <p>
              <strong>At {level}% chamber O₂: </strong>
              {ambient.length === 0 && <span className="readout-gap">no investigation's tested range includes this level.</span>}
              {ambientNear.length > 0 && <>runs recorded within ±{NEAR} point in {list(ambientNear)}.</>}
              {ambientNear.length === 0 && ambient.length > 0 && <span className="readout-gap">no run recorded within ±{NEAR} point.</span>}
              {ambientRangeOnly.length > 0 && <> Tested range includes it, without a run that close: {list(ambientRangeOnly)}.</>}
              {burner.length > 0 && <> Burner-fed oxygen ranges include it in {list(burner)}.</>}
            </p>
            <p>
              <strong>Solid materials: </strong>
              {solids.length > 0
                ? <>{solidsNear.length > 0 ? <>runs within ±{NEAR} point in {list(solidsNear)}</> : <>range only, in {list(solids)}</>}.</>
                : <span className="readout-gap">no data at this level.{stats.topSolid && <> The highest chamber oxygen for a burned solid is {percentRange(stats.topSolid.max, stats.topSolid.max)} ({name(stats.topSolid.r)}).</>}</span>}
            </p>
          </div>
          <div style={{ marginTop: 14 }}>
            <Zone3PhaseMap o2={level} gravity={gravity} onSelectO2={setLevel} onSelectGravity={setGravity} />
          </div>
          <p className="sources">
            Sources: {missions.map((m, i) => <span key={m.id}>{i > 0 && "; "}<a href={m.source.url} target="_blank" rel="noreferrer">{m.name}: {m.source.label}</a></span>)}.
          </p>
        </section>

        <section className="panel" aria-labelledby="fuels-title">
          <PanelHead num={2} id="fuels-title" title="Fuels and materials by test runs" />
          <p className="panel-lede">Rows in the PSI experiment tables that name each fuel. One row is usually one run; FLEX-2 lists one row per fuel. Select a fuel to open it in the experiment library.</p>
          <FuelRuns totals={stats.fuels} limit={showAllFuels ? stats.fuels.length : FUELS_SHOWN}
            hrefFor={(fuel) => explorerUrl({ fuel: [fuel] })} onClick={onLink} />
          {stats.fuels.length > FUELS_SHOWN && (
            <p className="panel-foot">
              <button type="button" onClick={() => setShowAllFuels((v) => !v)} aria-expanded={showAllFuels}>
                {showAllFuels ? `Show the top ${FUELS_SHOWN}` : `Show all ${stats.fuels.length} fuels and materials`}
              </button>
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="coverage-title">
          <PanelHead num={3} id="coverage-title" title="Oxygen coverage map" />
          <p className="panel-lede">Each row is an investigation that records oxygen in its experiment tables; the bar runs from the lowest to the highest level it reports, not every level in between.</p>
          <OxygenCoverage records={records} references={references} hrefFor={detailUrl} onClick={onLink} />
          {stats.noO2.length > 0 && (
            <p className="muted-list">Not shown, no oxygen in their tables: {list(stats.noO2)}.</p>
          )}
          <p className="sources">Oxygen percentage alone does not set flammability; the mission presets also differ in pressure.</p>
        </section>

        <section className="panel" aria-labelledby="gaps-title">
          <PanelHead num={4} id="gaps-title" title="Evidence gaps and research assistant" />
          <ul className="gaps">
            <li>
              <strong>No partial gravity</strong>
              {stats.platforms.iss} investigations flew on the ISS, {stats.platforms.cygnus} inside a Cygnus vehicle and {stats.platforms.ground} are
              ground studies. None burned anything at lunar (0.17 g) or Martian (0.38 g) gravity.
            </li>
            {stats.topSolid && (
              <li>
                <strong>Solids stop at {percentRange(stats.topSolid.max, stats.topSolid.max)} oxygen</strong>
                The highest chamber oxygen for any burned solid is in{" "}
                <a href={detailUrl(stats.topSolid.r.id)} onClick={onLink}>{name(stats.topSolid.r)}</a>. The proposed exploration atmosphere is 34%.
              </li>
            )}
            <li>
              <strong>{stats.noO2.length} of {records.length} record no oxygen</strong>
              Their experiment tables, where they exist, do not list it, so they cannot be placed on the coverage map.
            </li>
            {stats.noTable.length > 0 && (
              <li>
                <strong>{stats.noTable.length} have no experiment table</strong>
                {list(stats.noTable)}{stats.noTableAllGround ? ", all ground studies or analyses of flight data." : "."}
              </li>
            )}
          </ul>
          <div className="slot-empty" style={{ display: "grid", gap: 10 }}>
            <p className="slot-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ChamberSvg size={20} /> 3D Flame Chamber & Source-Grounded SI Assistant
            </p>
            <p>
              Launch the <a href={viewUrl("chamber")} onClick={onLink}>3D WebGL Flame Chamber (24,000 GPU particles)</a> or query the{" "}
              <a href={viewUrl("assistant")} onClick={onLink}>Source-Grounded Research Assistant</a>.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", color: "var(--muted)", fontSize: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><SatelliteSvg size={16} /> ISS 0g</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><RocketSvg size={16} /> Cygnus</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldSvg size={16} /> Zero-Fabrication</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="timeline-title">
        <PanelHead num={5} id="timeline-title" title="When did the investigations run?" />
        <p className="panel-lede">Start and end dates as listed on PSI. Program-level records such as ACME span several flight campaigns.</p>
        <Timeline records={records} hrefFor={detailUrl} onClick={onLink} />
      </section>
    </div>
  );
}
