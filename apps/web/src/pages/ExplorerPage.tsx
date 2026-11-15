import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { FilterPanel } from "../components/FilterPanel";
import { InvestigationCard } from "../components/InvestigationCard";
import { ResizableSplit } from "../components/Resizable";
import { listInvestigations } from "../lib/data";
import { activeCount, emptyFilters, filtersFromUrl, filtersToParams, o2Active, o2RangeError } from "../lib/filters";
import type { Filters } from "../lib/filters";
import { platformLabels, topicLabels } from "../lib/labels";
import { routeUrl } from "../lib/route";
import type { Navigate, Route } from "../lib/route";
import type { Facets, Investigation, Platform, Summary, Topic } from "../types";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 200;

export function ExplorerPage({ route, navigate, summary, facets, onOpen }: {
  route: Route;
  navigate: Navigate;
  summary: Summary | null;
  facets: Facets | null;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const [records, setRecords] = useState<Investigation[]>([]);
  const [matchedPublications, setMatchedPublications] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const invalidO2 = o2RangeError(route.filters) !== null;
  const filterKey = filtersToParams(route.filters).toString();

  useEffect(() => {
    if (invalidO2) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(() => {
      listInvestigations(filtersFromUrl(new URLSearchParams(filterKey)), route.page * PAGE_SIZE, PAGE_SIZE).then((page) => {
        if (cancelled) return;
        setRecords(page.items);
        setMatchedPublications(page.matchedPublications);
        setTotal(page.total);
      }).catch(() => {
        if (cancelled) return;
        setError(true);
        setRecords([]);
        setTotal(0);
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [route.page, filterKey, invalidO2, attempt]);

  const changeFilters = (filters: Filters) => navigate({ view: "explorer", id: null, filters, page: 0 }, false);
  const changePage = (page: number) => {
    navigate({ ...route, page }, true);
    document.getElementById("results-title")?.scrollIntoView({ block: "start" });
  };
  const count = activeCount(route.filters);
  const panelCount = count - (route.filters.q.trim() ? 1 : 0); // search lives outside the filter panel
  const chips = facets ? activeChips(route.filters) : [];

  return (
    <>
      <header className="page-header">
        <h1>Experiment library</h1>
        <p>
          Filter NASA PSI Combustion Science investigations by fuel, oxygen level, test environment and hardware.
          Fuel and oxygen come from each investigation’s own experiment tables, with the source column shown.
        </p>
      </header>

      <ResizableSplit
        className="explorer"
        ariaLabel="Resize filters sidebar and experiment results"
        mode="left-px"
        defaultSize={280}
        leftMin={220}
        rightMin={320}
        storageKey="fa-resize-explorer"
        left={
          <aside className="sidebar" aria-label="Filters">
            <button type="button" className="filters-toggle" aria-expanded={filtersOpen} aria-controls="filter-panel"
              onClick={() => setFiltersOpen((v) => !v)}>
              {filtersOpen ? "Hide filters" : "Show filters"}{panelCount > 0 && <span className="badge-count">{panelCount}</span>}
            </button>
            <div id="filter-panel" className={filtersOpen ? "filter-panel open" : "filter-panel"}>
              {facets ? (
                <FilterPanel facets={facets} filters={route.filters} onChange={changeFilters}
                  totalInvestigations={summary?.investigations ?? 0} />
              ) : <p className="state" role="status">Loading filters…</p>}
            </div>
          </aside>
        }
        right={
          <section className="results-panel" aria-labelledby="results-title">
          <div className="library-search" role="search">
            <label className="field-label" htmlFor="library-search">Search experiments and publications</label>
            <input
              id="library-search" type="search" value={route.filters.q}
              placeholder="Experiment, fuel, paper title, author or DOI"
              onChange={(event) => changeFilters({ ...route.filters, q: event.target.value })}
            />
            <p className="field-help">Every word must appear in the investigation or one of its {summary ? `${summary.publications} linked publications` : "linked publications"}.</p>
          </div>
          <div className="results-header">
            <h2 id="results-title" aria-live="polite">
              {invalidO2 ? "Oxygen range is not valid" : loading ? "Filtering…" : `${total} ${total === 1 ? "investigation" : "investigations"} found`}
            </h2>
            {count > 0 && <button type="button" className="link-button" onClick={() => changeFilters(emptyFilters)}>Clear all filters</button>}
          </div>
          {chips.length > 0 && (
            <ul className="chips" aria-label="Active filters">
              {chips.map((chip) => (
                <li key={chip.key}>
                  <button type="button" onClick={() => changeFilters(chip.remove(route.filters))} aria-label={`Remove filter ${chip.label}`}>
                    {chip.label}<span aria-hidden="true"> ×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="results" aria-busy={loading}>
            {invalidO2 && <p className="state" role="status">Fix the oxygen range in the filters to see results.</p>}
            {!invalidO2 && loading && records.length === 0 && <p className="state" role="status">Loading investigations…</p>}
            {!invalidO2 && !loading && error && (
              <div className="state" role="alert">
                <h3>The list could not be loaded</h3>
                <p>Check your connection and try again.</p>
                <button type="button" onClick={() => setAttempt((v) => v + 1)}>Try again</button>
              </div>
            )}
            {!invalidO2 && !loading && !error && records.length === 0 && (
              <div className="state" role="status">
                <h3>No investigation matches</h3>
                <p>{o2Active(route.filters)
                  ? "The oxygen filter keeps only investigations that record oxygen in their experiment tables. Widen the range or remove a filter."
                  : "Remove a filter or try another search term."}</p>
                <button type="button" onClick={() => changeFilters(emptyFilters)}>Clear all filters</button>
              </div>
            )}
            {!invalidO2 && !error && records.length > 0 && (
              <div className={loading ? "record-list is-stale" : "record-list"}>
                {records.map((record) => (
                  <InvestigationCard key={record.id} record={record} href={routeUrl({ ...route, id: record.id })} onOpen={onOpen}
                    matchedPublication={matchedPublications[record.id]} />
                ))}
              </div>
            )}
          </div>

          {!invalidO2 && !error && total > PAGE_SIZE && (
            <nav className="pagination" aria-label="Pagination">
              <span>{route.page * PAGE_SIZE + 1}–{Math.min((route.page + 1) * PAGE_SIZE, total)} of {total}</span>
              <div>
                <button type="button" disabled={route.page === 0} onClick={() => changePage(route.page - 1)}>Previous page</button>
                <button type="button" disabled={(route.page + 1) * PAGE_SIZE >= total} onClick={() => changePage(route.page + 1)}>Next page</button>
              </div>
            </nav>
          )}
        </section>
        }
      />
    </>
  );
}

interface Chip { key: string; label: string; remove: (f: Filters) => Filters }

function activeChips(filters: Filters): Chip[] {
  const chips: Chip[] = [];
  if (filters.q.trim()) chips.push({ key: "q", label: `“${filters.q.trim()}”`, remove: (f) => ({ ...f, q: "" }) });
  const list = (key: "fuel" | "platform" | "topic" | "hardware" | "family", label: (v: string) => string) => {
    for (const value of filters[key]) {
      chips.push({ key: `${key}-${value}`, label: label(value), remove: (f) => ({ ...f, [key]: f[key].filter((v) => v !== value) }) });
    }
  };
  list("fuel", (v) => v);
  if (o2Active(filters)) {
    const parts = [filters.o2Min && `from ${filters.o2Min}`, filters.o2Max && `to ${filters.o2Max}`].filter(Boolean).join(" ");
    chips.push({
      key: "o2", label: `O₂ ${parts ? `${parts}%` : "recorded"}${filters.ambientOnly ? ", chamber only" : ""}`,
      remove: (f) => ({ ...f, o2Min: "", o2Max: "", ambientOnly: false }),
    });
  }
  list("platform", (v) => platformLabels[v as Platform] ?? v);
  list("hardware", (v) => v);
  list("topic", (v) => topicLabels[v as Topic] ?? v);
  list("family", (v) => v);
  if (filters.hasTable) chips.push({ key: "table", label: "Has an experiment table", remove: (f) => ({ ...f, hasTable: false }) });
  return chips;
}
