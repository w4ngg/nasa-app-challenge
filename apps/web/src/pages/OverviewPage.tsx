import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { FuelRuns, OxygenCoverage, Timeline } from "../components/charts";
import { getAllInvestigations } from "../lib/data";
import { emptyFilters } from "../lib/filters";
import { percentRange } from "../lib/labels";
import { missions } from "../lib/missions";
import { explorerUrl, routeUrl } from "../lib/route";
import type { FuelCategory, Investigation, Summary } from "../types";

const detailUrl = (id: string) => routeUrl({ view: "overview", id, filters: emptyFilters, page: 0 });
const name = (r: Investigation) => r.acronym || r.id;

function spans(r: Investigation, level: number, basis: "ambient" | "oxidizer_stream") {
  return r.conditions.o2.some((o) => o.basis === basis && o.min_percent <= level && level <= o.max_percent);
}

export function OverviewPage({ summary, onLink }: {
  summary: Summary | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [records, setRecords] = useState<Investigation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState(34);
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
  const burner = records.filter((r) => spans(r, level, "oxidizer_stream") && !ambient.includes(r));
  const solids = ambient.filter((r) => r.conditions.fuel_categories.includes("solid"));
  const references = [
    { value: 21, label: "21%: Earth air (ISS cabin)", selected: level === 21 },
    { value: 34, label: "34%: proposed exploration atmosphere", selected: level === 34 },
    ...(level !== 21 && level !== 34 ? [{ value: level, label: `${level}%: selected level`, selected: true }] : []),
  ];
  const list = (items: Investigation[]) => items.map((r, i) => (
    <span key={r.id}>{i > 0 && ", "}<a href={detailUrl(r.id)} onClick={onLink}>{name(r)}</a></span>
  ));

  return (
    <div className="overview">
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">What NASA has tested, and where the evidence stops</h1>
        <p>
          {records.length} Combustion Science investigations from NASA PSI, {stats.rows.toLocaleString("en-US")} experiment-table
          rows and {summary?.publications ?? "their"} linked publications. Pick a cabin atmosphere to see which experiments cover it.
        </p>
        {summary?.retrieved_at && (
          <p className="intro-meta">Retrieved from PSI on {new Date(summary.retrieved_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}.</p>
        )}
      </section>

      <section className="panel panel-focus" aria-labelledby="coverage-title">
        <div className="panel-head"><span className="panel-num" aria-hidden="true">1</span><h2 id="coverage-title">Which oxygen levels have been tested?</h2></div>
        <p className="panel-lede">Choose a mission atmosphere or set any oxygen level. Each row is an investigation that records oxygen in its experiment tables; the bar spans the lowest to highest level it reports.</p>

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
            <strong>At {level}% O₂{mission ? ` (${mission.name})` : ""}: </strong>
            {ambient.length > 0
              ? <>chamber-atmosphere tests span this level in {ambient.length} {ambient.length === 1 ? "investigation" : "investigations"}: {list(ambient)}.</>
              : <span className="readout-gap">no investigation tested chamber oxygen at this level.</span>}
            {burner.length > 0 && <> Oxygen fed through a burner spans it in {list(burner)}.</>}
          </p>
          <p>
            <strong>Solid materials (cabin fabrics, plastics, wiring insulation): </strong>
            {solids.length > 0
              ? <>{list(solids)}.</>
              : <span className="readout-gap">no data at this level.{stats.topSolid && <> The highest chamber oxygen for a burned solid is {percentRange(stats.topSolid.max, stats.topSolid.max)} ({name(stats.topSolid.r)}).</>}</span>}
          </p>
        </div>

        <OxygenCoverage records={records} references={references} hrefFor={detailUrl} onClick={onLink} />

        <p className="sources">
          Ranges are the lowest and highest oxygen recorded per table, not every level in between. Oxygen percentage alone does not set
          flammability, and the presets also differ in pressure. Preset sources:{" "}
          {missions.map((m, i) => <span key={m.id}>{i > 0 && "; "}<a href={m.source.url} target="_blank" rel="noreferrer">{m.name}: {m.source.label}</a></span>)}.
        </p>
        {stats.noO2.length > 0 && (
          <p className="muted-list">Not shown, no oxygen in their tables: {list(stats.noO2)}.</p>
        )}
      </section>

      <div className="panel-row">
        <section className="panel" aria-labelledby="fuels-title">
          <div className="panel-head"><span className="panel-num" aria-hidden="true">2</span><h2 id="fuels-title">Which fuels and materials were burned most?</h2></div>
          <p className="panel-lede">Rows in the PSI experiment tables that name each fuel. One row is usually one test run; FLEX-2 lists one row per fuel. Select a fuel to open it in the explorer.</p>
          <FuelRuns totals={stats.fuels} limit={showAllFuels ? stats.fuels.length : 10}
            hrefFor={(fuel) => explorerUrl({ fuel: [fuel] })} onClick={onLink} />
          {stats.fuels.length > 10 && (
            <p className="panel-foot">
              <button type="button" onClick={() => setShowAllFuels((v) => !v)} aria-expanded={showAllFuels}>
                {showAllFuels ? "Show the top 10" : `Show all ${stats.fuels.length} fuels and materials`}
              </button>
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="gaps-title">
          <div className="panel-head"><span className="panel-num" aria-hidden="true">3</span><h2 id="gaps-title">Where does the evidence stop?</h2></div>
          <p className="panel-lede">Computed from the catalog, so they update with the data.</p>
          <ul className="gaps">
            <li>
              <strong>No partial gravity</strong>
              {stats.platforms.iss} investigations flew on the ISS, {stats.platforms.cygnus} inside a Cygnus vehicle and {stats.platforms.ground} are ground
              studies. None burned anything at lunar (0.17 g) or Martian (0.38 g) gravity.
            </li>
            {stats.topSolid && (
              <li>
                <strong>Solids stop at {percentRange(stats.topSolid.max, stats.topSolid.max)} oxygen</strong>
                The highest chamber oxygen for any burned solid material is in{" "}
                <a href={detailUrl(stats.topSolid.r.id)} onClick={onLink}>{name(stats.topSolid.r)}</a>. The proposed exploration atmosphere is 34%.
              </li>
            )}
            <li>
              <strong>{stats.noO2.length} of {records.length} record no oxygen</strong>
              Their experiment tables, where they exist, do not list the oxygen level, so they cannot be placed on the oxygen axis.
            </li>
            {stats.noTable.length > 0 && (
              <li>
                <strong>{stats.noTable.length} have no experiment table</strong>
                {list(stats.noTable)}{stats.noTableAllGround ? ", all ground studies or analyses of flight data." : "."}
              </li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel" aria-labelledby="timeline-title">
        <div className="panel-head"><span className="panel-num" aria-hidden="true">4</span><h2 id="timeline-title">When did the investigations run?</h2></div>
        <p className="panel-lede">Start and end dates as listed on PSI. Program-level records such as ACME span several flight campaigns.</p>
        <Timeline records={records} hrefFor={detailUrl} onClick={onLink} />
        <p className="panel-foot"><a href={explorerUrl()} onClick={onLink}>Open the explorer to filter all {records.length} investigations</a></p>
      </section>
    </div>
  );
}
