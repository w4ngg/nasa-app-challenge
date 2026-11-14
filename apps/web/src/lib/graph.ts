// Knowledge graph data (graph.json from flame-export-static) and the logic the map uses:
// search, hierarchy paths, evidence paths and compatibility-checked comparison.
import { percentRange, platformLabels } from "./labels";
import { normalize, queryWords } from "./data";
import type { O2Observation, Platform } from "../types";

export type NodeType = "resource" | "program" | "investigation" | "publication" | "dataset" | "concept";
export type EdgeType = "includes" | "lists_publication" | "has_dataset" | "studies" | "uses_fuel" | "related_to";

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  title?: string;
  url?: string;
  group?: "phenomenon" | "fuel";
  category?: string;
  platform?: string;
  fuels?: string[];
  fuel_categories?: string[];
  o2?: O2Observation[];
  runs?: number;
  hardware?: string[];
  authors?: string;
  doi?: string | null;
  rows?: number;
  columns?: string[];
  fuel_column?: string | null;
  o2_column?: string | null;
  o2_basis?: string | null;
  investigation?: string;
}

export interface GEdge { id: string; source: string; target: string; type: EdgeType; evidence: string; url: string }
export interface GraphData { nodes: GNode[]; edges: GEdge[]; not_built: string[] }

export const HIERARCHY: EdgeType[] = ["includes", "lists_publication", "has_dataset"];

export const edgeLabels: Record<EdgeType, string> = {
  includes: "includes",
  lists_publication: "lists publication",
  has_dataset: "has dataset",
  studies: "studies",
  uses_fuel: "uses fuel",
  related_to: "related to",
};

export const typeLabels: Record<NodeType, string> = {
  resource: "Resource", program: "Program", investigation: "Investigation",
  publication: "Publication", dataset: "Dataset", concept: "Concept",
};

let request: Promise<GraphData> | null = null;
export function loadGraph(): Promise<GraphData> {
  request ??= fetch(`${import.meta.env.BASE_URL}data/graph.json`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<GraphData>;
  }).catch((e: unknown) => { request = null; throw e; });
  return request;
}

export class GraphIndex {
  nodes = new Map<string, GNode>();
  out = new Map<string, GEdge[]>();
  into = new Map<string, GEdge[]>();
  private text = new Map<string, string>();

  constructor(public data: GraphData) {
    for (const n of data.nodes) {
      this.nodes.set(n.id, n);
      this.text.set(n.id, normalize([n.label, n.title ?? "", n.authors ?? "", n.doi ?? "", n.id, ...(n.fuels ?? [])].join(" ")));
    }
    for (const e of data.edges) {
      (this.out.get(e.source) ?? this.out.set(e.source, []).get(e.source)!).push(e);
      (this.into.get(e.target) ?? this.into.set(e.target, []).get(e.target)!).push(e);
    }
  }

  search(query: string): string[] {
    const words = queryWords(query);
    if (words.length === 0) return [];
    return [...this.text].filter(([, t]) => words.every((w) => t.includes(w))).map(([id]) => id);
  }

  /** Hierarchy parents (a publication listed by two investigations has two). */
  parents(id: string): GEdge[] {
    return (this.into.get(id) ?? []).filter((e) => HIERARCHY.includes(e.type));
  }

  children(id: string): GNode[] {
    return (this.out.get(id) ?? []).filter((e) => e.type === "lists_publication" || e.type === "has_dataset")
      .map((e) => this.nodes.get(e.target)!).filter(Boolean);
  }

  /** Every node on a hierarchy path from the resource down to `id`. */
  ancestors(id: string, seen = new Set<string>()): Set<string> {
    for (const e of this.parents(id)) {
      if (!seen.has(e.source)) { seen.add(e.source); this.ancestors(e.source, seen); }
    }
    return seen;
  }

  /** One evidence path from the resource to `id`, following the first parent at each level. */
  evidencePath(id: string, via?: string): GEdge[] {
    const path: GEdge[] = [];
    let current = id;
    for (let guard = 0; guard < 6; guard++) {
      const ups = this.parents(current);
      if (ups.length === 0) break;
      const edge = ups.find((e) => e.source === via) ?? ups[0];
      path.unshift(edge);
      current = edge.source;
    }
    return path;
  }

  /** Cross links of a node: concepts it studies, fuels, related investigations, and edges into concepts. */
  crossLinks(id: string): GEdge[] {
    const cross = (e: GEdge) => !HIERARCHY.includes(e.type);
    return [...(this.out.get(id) ?? []).filter(cross), ...(this.into.get(id) ?? []).filter(cross)];
  }
}

// ---------- comparison with compatibility checks ----------

export interface CompareRow { label: string; values: string[] }
export interface Comparison { kind: NodeType | "mixed"; rows: CompareRow[]; notes: string[]; ok: boolean }

const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(", ") : "not recorded");

function o2(n: GNode, basis: "ambient" | "oxidizer_stream"): { lo: number; hi: number } | null {
  const obs = (n.o2 ?? []).filter((o) => o.basis === basis);
  if (obs.length === 0) return null;
  return { lo: Math.min(...obs.map((o) => o.min_percent)), hi: Math.max(...obs.map((o) => o.max_percent)) };
}

export function compare(index: GraphIndex, ids: string[]): Comparison {
  const nodes = ids.map((id) => index.nodes.get(id)!).filter(Boolean);
  const kinds = new Set(nodes.map((n) => n.type));
  if (nodes.length < 2) return { kind: "mixed", rows: [], notes: ["Select at least two nodes to compare."], ok: false };
  if (kinds.size > 1) {
    return {
      kind: "mixed", rows: [], ok: false,
      notes: [`These are different kinds of nodes (${[...kinds].map((k) => typeLabels[k].toLowerCase()).join(", ")}). Compare works on nodes of the same kind: investigations with investigations, datasets with datasets.`],
    };
  }
  const kind = nodes[0].type;
  const concepts = (n: GNode) => new Set((index.out.get(n.id) ?? []).filter((e) => e.type === "studies").map((e) => index.nodes.get(e.target)?.label ?? e.target));
  const shared = (sets: Set<string>[]) => [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
  const notes: string[] = [];
  const rows: CompareRow[] = [];

  if (kind === "investigation") {
    rows.push(
      { label: "Title", values: nodes.map((n) => n.title ?? n.label) },
      { label: "Test environment", values: nodes.map((n) => platformLabels[(n.platform ?? "unknown") as Platform] ?? n.platform ?? "unknown") },
      { label: "Fuel phase", values: nodes.map((n) => list(n.fuel_categories)) },
      { label: "Fuels and materials", values: nodes.map((n) => list(n.fuels)) },
      { label: "Chamber oxygen", values: nodes.map((n) => { const r = o2(n, "ambient"); return r ? percentRange(r.lo, r.hi) : "not recorded"; }) },
      { label: "Burner-fed oxygen", values: nodes.map((n) => { const r = o2(n, "oxidizer_stream"); return r ? percentRange(r.lo, r.hi) : "none"; }) },
      { label: "Experiment-table rows", values: nodes.map((n) => String(n.runs ?? 0)) },
      { label: "Hardware", values: nodes.map((n) => list(n.hardware)) },
    );
    const phases = nodes.map((n) => (n.fuel_categories ?? []).join("+") || "unknown");
    if (new Set(phases).size > 1) notes.push(`Different fuel phases (${phases.join(" vs ")}): burning behaviour and measured quantities are not directly comparable.`);
    const platforms = new Set(nodes.map((n) => n.platform));
    if (platforms.has("ground") && platforms.size > 1) notes.push("One is a ground study or analysis, the other a flight experiment: gravity conditions differ.");
    const ranges = nodes.map((n) => o2(n, "ambient"));
    if (ranges.some((r) => !r)) notes.push("At least one investigation records no chamber oxygen, so oxygen conditions cannot be matched.");
    else if (Math.max(...ranges.map((r) => r!.lo)) > Math.min(...ranges.map((r) => r!.hi))) notes.push("Their chamber-oxygen ranges do not overlap.");
    if (nodes.some((n) => o2(n, "oxidizer_stream"))) notes.push("Burner-fed oxygen (inverse flames) is not the cabin oxygen level; it is shown separately.");
    const common = shared(nodes.map(concepts));
    rows.push({ label: "Concepts in common", values: nodes.map(() => common.length ? common.join(", ") : "none") });
    notes.push("Measured results such as spread rate or burn time are not compared here: they come from different tables, methods and units. Open each dataset to check.");
  } else if (kind === "dataset") {
    rows.push(
      { label: "Table", values: nodes.map((n) => n.title ?? n.label) },
      { label: "Investigation", values: nodes.map((n) => n.investigation ?? "") },
      { label: "Rows", values: nodes.map((n) => String(n.rows ?? 0)) },
      { label: "Fuel column", values: nodes.map((n) => n.fuel_column ?? "none") },
      { label: "Oxygen column", values: nodes.map((n) => n.o2_column ? `${n.o2_column} (${n.o2_basis === "oxidizer_stream" ? "burner-fed" : "chamber"})` : "none") },
    );
    const sameName = shared(nodes.map((n) => new Set((n.columns ?? []).map((c) => c.toLowerCase()))));
    rows.push({ label: "Columns with the same name", values: nodes.map(() => sameName.length ? sameName.join(", ") : "none") });
    if (sameName.length) notes.push("A shared column name is not proof of the same measurement: units, instruments and test conditions can differ. Values are not compared automatically.");
    const bases = new Set(nodes.map((n) => n.o2_basis).filter(Boolean));
    if (bases.size > 1) notes.push("One table records chamber oxygen and the other burner-fed oxygen.");
  } else if (kind === "publication") {
    const parents = (n: GNode) => index.parents(n.id).map((e) => index.nodes.get(e.source)?.label ?? e.source);
    rows.push(
      { label: "Title", values: nodes.map((n) => n.title ?? n.label) },
      { label: "Authors", values: nodes.map((n) => n.authors || "not listed") },
      { label: "DOI", values: nodes.map((n) => n.doi ?? "none") },
      { label: "Listed by", values: nodes.map((n) => parents(n).join(", ")) },
      { label: "Concepts in title", values: nodes.map((n) => [...concepts(n)].join(", ") || "none") },
    );
    notes.push("Objectives, methods and conclusions need the full text, which is not in this catalog. Open each DOI to compare them.");
  } else if (kind === "concept") {
    const studiedBy = (n: GNode) => new Set((index.into.get(n.id) ?? []).filter((e) => e.type === "studies" || e.type === "uses_fuel")
      .map((e) => index.nodes.get(e.source)).filter((s) => s?.type === "investigation").map((s) => s!.label));
    const sets = nodes.map(studiedBy);
    rows.push(
      { label: "Investigations", values: sets.map((s) => [...s].join(", ") || "none") },
      { label: "Investigations in common", values: nodes.map(() => shared(sets).join(", ") || "none") },
    );
  } else {
    rows.push({ label: "Label", values: nodes.map((n) => n.label) });
  }
  return { kind, rows, notes, ok: true };
}
