// Static data layer: the site reads JSON exported by `flame-export-static`
// (apps/api/src/flame_api/export_static.py), so the deployed page needs no server.
// Filter semantics mirror apps/api/src/flame_api/routes/catalog.py.
import type { Filters } from "./filters";
import { validPercent } from "./filters";
import type {
  ExperimentalTable, FacetOption, Facets, Investigation, InvestigationDetail, Page, Publication, Summary,
} from "../types";

interface CatalogIndex {
  schema_version: number;
  retrieved_at: string | null;
  investigations: Investigation[];
  publications: Publication[];
  links: { investigation_id: string; publication_id: string }[];
}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;
let indexRequest: Promise<CatalogIndex> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(dataUrl(path), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function loadIndex(): Promise<CatalogIndex> {
  indexRequest ??= getJson<CatalogIndex>("index.json").catch((error: unknown) => {
    indexRequest = null; // allow "Try again" to refetch
    throw error;
  });
  return indexRequest;
}

export class NotFoundError extends Error {}

export async function getSummary(): Promise<Summary> {
  const index = await loadIndex();
  return {
    investigations: index.investigations.length,
    publications: index.publications.length,
    publication_links: index.links.length,
    full_text_publications: index.publications.filter((p) => p.availability === "full_text").length,
    catalog_state: index.investigations.length ? "loaded" : "empty",
    retrieved_at: index.retrieved_at,
  };
}

function options(values: string[], groups: Record<string, string> = {}): FacetOption[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count, group: groups[value] ?? null }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export async function getFacets(): Promise<Facets> {
  const records = (await loadIndex()).investigations;
  const groups: Record<string, string> = {};
  for (const r of records) Object.assign(groups, r.conditions.fuel_groups);
  const o2 = records.flatMap((r) => r.conditions.o2);
  return {
    families: options(records.flatMap((r) => (r.family ? [r.family] : []))),
    platforms: options(records.map((r) => r.platform)),
    topics: options(records.map((r) => r.topic)),
    hardware: options(records.flatMap((r) => r.hardware_tags)),
    fuels: options(records.flatMap((r) => r.conditions.fuels), groups),
    with_o2: records.filter((r) => r.conditions.o2.length > 0).length,
    with_tables: records.filter((r) => r.conditions.run_count > 0).length,
    o2_min: o2.length ? Math.min(...o2.map((o) => o.min_percent)) : null,
    o2_max: o2.length ? Math.max(...o2.map((o) => o.max_percent)) : null,
  };
}

function searchText(r: Investigation): string {
  return [r.id, r.title, r.acronym ?? "", r.family ?? "", r.objective, r.approach, r.hardware ?? "", ...r.conditions.fuels]
    .join(" ").toLowerCase();
}

/** Values inside one filter are OR-ed; different filters are AND-ed. */
export function matches(r: Investigation, f: Filters): boolean {
  const any = (selected: string[], values: string[]) => selected.length === 0 || selected.some((v) => values.includes(v));
  const term = f.q.trim().toLowerCase();
  const o2Active = validPercent(f.o2Min) || validPercent(f.o2Max) || f.ambientOnly;
  const low = validPercent(f.o2Min) ? Number(f.o2Min) : 0;
  const high = validPercent(f.o2Max) ? Number(f.o2Max) : 100;
  return any(f.family, r.family ? [r.family] : [])
    && any(f.platform, [r.platform])
    && any(f.topic, [r.topic])
    && any(f.hardware, r.hardware_tags)
    && any(f.fuel, r.conditions.fuels)
    && (!o2Active || r.conditions.o2.some((o) => (!f.ambientOnly || o.basis === "ambient") && o.min_percent <= high && o.max_percent >= low))
    && (!f.hasTable || r.conditions.run_count > 0)
    && (!term || searchText(r).includes(term));
}

export async function getAllInvestigations(): Promise<Investigation[]> {
  return (await loadIndex()).investigations;
}

export async function listInvestigations(filters: Filters, offset: number, limit: number): Promise<Page<Investigation>> {
  const records = (await loadIndex()).investigations.filter((r) => matches(r, filters));
  return { items: records.slice(offset, offset + limit), total: records.length, offset, limit };
}

export async function getInvestigation(id: string): Promise<InvestigationDetail> {
  const index = await loadIndex();
  const investigation = index.investigations.find((r) => r.id === id);
  if (!investigation) throw new NotFoundError(id);
  const pubIds = new Set(index.links.filter((l) => l.investigation_id === id).map((l) => l.publication_id));
  const titles = new Map(index.investigations.map((r) => [r.id, r.title]));
  const tables = investigation.conditions.tables.length
    ? await getJson<ExperimentalTable[]>(`tables/${encodeURIComponent(id)}.json`)
    : [];
  return {
    investigation,
    publications: index.publications.filter((p) => pubIds.has(p.id)),
    tables,
    related: investigation.related_ids.map((rid) => ({ id: rid, title: titles.get(rid) ?? null })),
  };
}
