import type { MouseEvent } from "react";
import { emptyFilters, filtersFromUrl, filtersToParams } from "./filters";
import type { Filters } from "./filters";

// Query-string routing: every view is index.html?…, so deep links work on static
// hosts such as GitHub Pages without server-side rewrites.
export type View = "overview" | "map" | "explorer" | "forecast" | "chamber" | "compare" | "assistant" | "habitat" | "lab";

const views: View[] = ["overview", "map", "explorer", "forecast", "chamber", "compare", "assistant", "habitat", "lab"];

export interface Route {
  view: View;
  id: string | null;
  filters: Filters;
  page: number;
  /** Data analytics only: which experiment table to open (e.g. "flex"), so other pages can deep-link to it. */
  dataset?: string | null;
}

export function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("view") as View | null;
  const view: View = requested && views.includes(requested) ? requested : "overview";
  return {
    view,
    id: params.get("id"),
    filters: view === "explorer" ? filtersFromUrl(params) : emptyFilters,
    page: Math.max(0, Number(params.get("page")) || 0),
    dataset: view === "lab" ? params.get("dataset") : null,
  };
}

export function routeUrl(route: Route): string {
  const params = new URLSearchParams();
  if (route.view === "explorer") {
    params.set("view", "explorer");
    for (const [key, value] of filtersToParams(route.filters)) params.append(key, value);
    if (route.page > 0) params.set("page", String(route.page));
  } else if (route.view !== "overview") {
    params.set("view", route.view);
  }
  if (route.view === "lab" && route.dataset) params.set("dataset", route.dataset);
  if (route.id) params.set("id", route.id);
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

export function viewUrl(view: View): string {
  return routeUrl({ view, id: null, filters: emptyFilters, page: 0 });
}

export function explorerUrl(filters: Partial<Filters> = {}): string {
  return routeUrl({ view: "explorer", id: null, filters: { ...emptyFilters, ...filters }, page: 0 });
}

/** Plain left click navigates in-app; modified clicks keep the browser's new-tab behaviour. */
export function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export type Navigate = (next: Route, push: boolean) => void;

/** Click handler for any in-app link whose href was built by routeUrl. */
export function linkHandler(navigate: Navigate) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    const url = new URL(event.currentTarget.href);
    window.history.pushState(null, "", url.search || window.location.pathname);
    navigate(readRoute(), false);
    window.scrollTo({ top: 0 });
  };
}
