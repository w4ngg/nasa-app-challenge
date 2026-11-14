import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { InvestigationDetail } from "./components/InvestigationDetail";
import { getFacets, getSummary } from "./lib/data";
import { emptyFilters } from "./lib/filters";
import { explorerUrl, isPlainClick, linkHandler, readRoute, routeUrl } from "./lib/route";
import type { Route } from "./lib/route";
import { ExplorerPage } from "./pages/ExplorerPage";
import { OverviewPage } from "./pages/OverviewPage";
import type { Facets, Summary } from "./types";

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route, push: boolean) => {
    const url = routeUrl(next);
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setRoute(next);
  }, []);
  const onLink = linkHandler(navigate);

  useEffect(() => {
    // Pages show their own error states; the shell only needs these for counts and filters.
    Promise.all([getSummary(), getFacets()]).then(([s, f]) => { setSummary(s); setFacets(f); }).catch(() => undefined);
  }, []);

  const openInvestigation = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate({ ...route, id }, true);
    window.scrollTo({ top: 0 });
  };
  const backToList = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate({ ...route, id: null }, true);
  };

  const overviewHref = routeUrl({ view: "overview", id: null, filters: emptyFilters, page: 0 });
  const current = route.id ? null : route.view;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href={overviewHref} onClick={onLink} aria-label="Flame Atlas, overview">
          <span className="brand-mark" aria-hidden="true">FA</span>
          <span>Flame Atlas<small>Microgravity combustion evidence</small></span>
        </a>
        <nav className="main-nav" aria-label="Main">
          <a href={overviewHref} onClick={onLink} aria-current={current === "overview" ? "page" : undefined}>Overview</a>
          <a href={explorerUrl()} onClick={onLink} aria-current={current === "explorer" ? "page" : undefined}>Explorer</a>
        </nav>
        <a className="source-link" href="https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation" target="_blank" rel="noreferrer">Source: NASA PSI</a>
      </header>

      <main>
        {route.id ? (
          <InvestigationDetail id={route.id} backHref={routeUrl({ ...route, id: null })} backLabel={route.view === "explorer" ? "Back to the explorer" : "Back to the overview"}
            onBack={backToList} onOpen={openInvestigation} />
        ) : route.view === "explorer" ? (
          <ExplorerPage route={route} navigate={navigate} summary={summary} facets={facets} onOpen={openInvestigation} />
        ) : (
          <OverviewPage summary={summary} onLink={onLink} />
        )}
      </main>
      <footer>
        <span>Flame Atlas, a NASA Space Apps Challenge 2026 project for “Flame in Freefall”</span>
        <span>
          Data: NASA Physical Sciences Informatics, licensed per record. Built with AI-assisted coding;{" "}
          <a href="https://github.com/w4ngg/nasa-app-challenge#use-of-super-intelligence-si" target="_blank" rel="noreferrer">how SI was used</a>.
        </span>
      </footer>
    </div>
  );
}
