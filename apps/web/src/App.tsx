import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { InvestigationDetail } from "./components/InvestigationDetail";
import { SideNav } from "./components/SideNav";
import { getFacets, getSummary } from "./lib/data";
import { isPlainClick, linkHandler, readRoute, routeUrl } from "./lib/route";
import type { Route } from "./lib/route";
import { AssistantPage } from "./pages/AssistantPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
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

  let page;
  if (route.id) {
    page = (
      <InvestigationDetail id={route.id} backHref={routeUrl({ ...route, id: null })}
        backLabel={route.view === "explorer" ? "Back to the experiment library" : route.view === "assistant" ? "Back to the research assistant" : "Back to the overview"}
        onBack={backToList} onOpen={openInvestigation} />
    );
  } else if (route.view === "overview") {
    page = <OverviewPage summary={summary} onLink={onLink} />;
  } else if (route.view === "assistant") {
    page = <AssistantPage onLink={onLink} />;
  } else if (route.view === "explorer") {
    page = <ExplorerPage route={route} navigate={navigate} summary={summary} facets={facets} onOpen={openInvestigation} />;
  } else {
    page = <PlaceholderPage view={route.view} onLink={onLink} />;
  }

  return (
    <div className="layout">
      <SideNav current={route.id ? null : route.view} onLink={onLink} />
      <div className="content">
        <main>{page}</main>
        <footer>
          <span>Flame Atlas, a NASA Space Apps Challenge 2026 project for “Flame in Freefall”</span>
          <span>
            Data: NASA Physical Sciences Informatics, licensed per record. Built with AI-assisted coding;{" "}
            <a href="https://github.com/w4ngg/nasa-app-challenge#use-of-super-intelligence-si" target="_blank" rel="noreferrer">how SI was used</a>.
          </span>
        </footer>
      </div>
    </div>
  );
}
