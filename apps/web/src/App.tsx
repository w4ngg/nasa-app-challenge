import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { InvestigationDetail } from "./components/InvestigationDetail";
import { clamp, readStored, startPointerDrag, writeStored } from "./components/Resizable";
import { SideNav } from "./components/SideNav";
import { ThemeSwitcher } from "./design";
import { getFacets, getSummary } from "./lib/data";
import { isPlainClick, linkHandler, readRoute, routeUrl } from "./lib/route";
import type { Route } from "./lib/route";
import { AssistantPage } from "./pages/AssistantPage";
import { ChamberPage } from "./pages/ChamberPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { ForecastPage } from "./pages/ForecastPage";
// The graph library is large; load it only when the knowledge map is opened.
const KnowledgeMapPage = lazy(() => import("./pages/KnowledgeMapPage").then((m) => ({ default: m.KnowledgeMapPage })));
import { OverviewPage } from "./pages/OverviewPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
const DataAnalyticsPage = lazy(() => import("./pages/DataAnalyticsPage").then((m) => ({ default: m.DataAnalyticsPage })));
import type { Facets, Summary } from "./types";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sideWidth, setSideWidth] = useState<number | null>(() => readStored("fa-resize-layout-side", isFiniteNumber));
  const [resizingSide, setResizingSide] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);
  useEffect(() => {
    writeStored("fa-resize-layout-side", sideWidth);
  }, [sideWidth]);

  const handleSidePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed || !layoutRef.current) return;
    const nav = layoutRef.current.querySelector(".side-nav");
    const startW = nav?.getBoundingClientRect().width ?? sideWidth ?? 224;
    const maxW = Math.min(440, Math.max(240, Math.round(window.innerWidth * 0.42)));
    setResizingSide(true);
    dragCleanupRef.current = startPointerDrag(event, {
      cursor: "col-resize",
      onMove: (dx) => setSideWidth(Math.round(clamp(startW + dx, 170, maxW))),
      onEnd: () => setResizingSide(false),
    });
  };

  const handleSideKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      setSideWidth(null);
      return;
    }
    const delta = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
    if (!delta) return;
    event.preventDefault();
    const maxW = Math.min(440, Math.max(240, Math.round(window.innerWidth * 0.42)));
    setSideWidth((prev) => Math.round(clamp((prev ?? 224) + delta, 170, maxW)));
  };

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
        backLabel={route.view === "explorer" ? "Back to the experiment library" : route.view === "assistant" ? "Back to the research assistant" : route.view === "map" ? "Back to the knowledge map" : route.view === "lab" ? "Back to data analytics" : "Back to the overview"}
        onBack={backToList} onOpen={openInvestigation} />
    );
  } else if (route.view === "overview") {
    page = <OverviewPage summary={summary} onLink={onLink} />;
  } else if (route.view === "chamber") {
    page = <ChamberPage onLink={onLink} />;
  } else if (route.view === "map") {
    page = <Suspense fallback={<p className="state" role="status">Loading the knowledge map…</p>}><KnowledgeMapPage onLink={onLink} /></Suspense>;
  } else if (route.view === "assistant") {
    page = <AssistantPage onLink={onLink} />;
  } else if (route.view === "explorer") {
    page = <ExplorerPage route={route} navigate={navigate} summary={summary} facets={facets} onOpen={openInvestigation} />;
  } else if (route.view === "forecast") {
    page = <ForecastPage />;
  } else if (route.view === "lab") {
    page = <Suspense fallback={<p className="state" role="status">Loading data analytics…</p>}><DataAnalyticsPage onLink={onLink} initialDataset={route.dataset ?? undefined} /></Suspense>;
  } else {
    page = <PlaceholderPage view={route.view} onLink={onLink} />;
  }

  const layoutClass = [
    "layout",
    sidebarCollapsed ? "is-collapsed" : "",
    resizingSide ? "is-resizing-side" : "",
  ].filter(Boolean).join(" ");
  const layoutStyle = !sidebarCollapsed && sideWidth != null
    ? ({ "--side-w": `${sideWidth}px` } as CSSProperties)
    : undefined;

  return (
    <div ref={layoutRef} className={layoutClass} style={layoutStyle}>
      <SideNav
        current={route.id ? null : route.view}
        onLink={onLink}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <div className="content">
        <div
          className="layout-side-edge"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag border to resize navigation sidebar"
          tabIndex={sidebarCollapsed ? -1 : 0}
          title="Drag border to resize sidebar · Double-click to reset"
          onPointerDown={handleSidePointerDown}
          onKeyDown={handleSideKeyDown}
          onDoubleClick={() => setSideWidth(null)}
        />
        <ThemeSwitcher />
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
