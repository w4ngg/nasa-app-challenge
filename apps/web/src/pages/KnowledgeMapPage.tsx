import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { ObsidianKnowledgeGraph } from "../components/ObsidianKnowledgeGraph";
import { GRAPH_CLUSTER_COLORS } from "../design/tokens";
import { emptyFilters } from "../lib/filters";
import { compare, edgeLabels, GraphIndex, loadGraph, typeLabels } from "../lib/graph";
import type { GEdge, GNode } from "../lib/graph";
import { percentRange } from "../lib/labels";
import { routeUrl } from "../lib/route";

type Toggle = "publication" | "dataset" | "concept" | "fuel";
const TOGGLES: { key: Toggle; label: string }[] = [
  { key: "concept", label: "Concepts" },
  { key: "fuel", label: "Fuels and materials" },
  { key: "publication", label: "Publications" },
  { key: "dataset", label: "Datasets" },
];
const MAX_COMPARE = 3;
const detailHref = (id: string) => routeUrl({ view: "map", id, filters: emptyFilters, page: 0 });

function nodeSummary(n: GNode): string {
  if (n.type === "investigation") {
    const ch = (n.o2 ?? []).filter((o) => o.basis === "ambient");
    const o2 = ch.length
      ? `, chamber O₂ ${percentRange(Math.min(...ch.map((o) => o.min_percent)), Math.max(...ch.map((o) => o.max_percent)))}`
      : ", chamber O₂ not recorded";
    return `${n.title}${n.fuels?.length ? `. Fuels: ${n.fuels.join(", ")}` : ""}${o2}`;
  }
  if (n.type === "publication") return `${n.authors || "Authors not listed"}${n.doi ? `. DOI ${n.doi}` : ""}`;
  if (n.type === "dataset") return `${n.rows} rows, ${n.columns?.length ?? 0} columns`;
  return n.title ?? "";
}

export function KnowledgeMapPage({ onLink }: { onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<Set<Toggle>>(new Set(["concept", "fuel"]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string[]>([]);

  useEffect(() => {
    loadGraph()
      .then((g) => setIndex(new GraphIndex(g)))
      .catch(() => setFailed(true));
  }, []);

  const matches = useMemo(() => {
    if (!index) return [] as string[];
    return index.search(query).filter((id) => index.nodes.get(id)?.type !== "resource");
  }, [index, query]);

  const { visible, highlight } = useMemo(() => {
    const visible = new Set<string>();
    const highlight = new Set<string>();
    if (!index) return { visible, highlight };
    for (const n of index.data.nodes) {
      const layer = n.type === "concept" ? (n.group === "fuel" ? "fuel" : "concept") : n.type;
      if (["resource", "program", "investigation"].includes(n.type) || shown.has(layer as Toggle)) {
        visible.add(n.id);
      }
    }
    for (const id of expanded) for (const c of index.children(id)) visible.add(c.id);
    for (const id of matches) {
      visible.add(id);
      highlight.add(id);
      for (const a of index.ancestors(id)) {
        visible.add(a);
        highlight.add(a);
      }
      if (index.nodes.get(id)?.type === "concept") {
        for (const e of index.into.get(id) ?? []) {
          if (index.nodes.get(e.source)?.type === "investigation") highlight.add(e.source);
        }
      }
    }
    if (selected) visible.add(selected);
    for (const id of comparing) visible.add(id);
    return { visible, highlight };
  }, [index, shown, expanded, matches, selected, comparing]);

  function toggleCompare(id: string) {
    setComparing((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? [...c.slice(1), id] : [...c, id]));
  }
  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function resetOverview() {
    setQuery("");
    setSelected(null);
    setExpanded(new Set());
  }
  function toggleLayer(key: Toggle) {
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (failed) {
    return (
      <div className="state" role="alert">
        <h1 className="state-title">The knowledge map could not be loaded</h1>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  if (!index) return <p className="state" role="status">Loading the Obsidian knowledge graph…</p>;

  const node = selected ? index.nodes.get(selected) : undefined;
  const path = selected ? index.evidencePath(selected) : [];
  const cross = selected ? index.crossLinks(selected) : [];
  const result = comparing.length >= 2 ? compare(index, comparing) : null;
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const listed = (matches.length ? matches : index.data.nodes.filter((n) => n.type === "investigation").map((n) => n.id)).slice(0, 60);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Obsidian Knowledge Graph</h1>
        <p>
          Force-directed NASA PSI evidence topology (Center Gravity + Coulomb Repulsion + Hooke Spring + Damping).
          Clustered by PSI CSV, Metadata·Abs, Fuel, Hardware, and Boundary·Gap.
        </p>
      </header>

      <section className="panel map-panel" aria-labelledby="map-title">
        <h2 id="map-title" className="sr-only">Graph</h2>
        <div className="map-toolbar">
          <div className="map-search" role="search">
            <label htmlFor="map-search" className="sr-only">Search the knowledge map</label>
            <input
              id="map-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: smoke detection, PMMA, FLEX, an author or a DOI"
            />
          </div>
          <div className="map-layers" role="group" aria-label="Layers">
            {TOGGLES.map((t) => (
              <label key={t.key} htmlFor={`layer-${t.key}`} className="check-inline">
                <input id={`layer-${t.key}`} type="checkbox" checked={shown.has(t.key)} onChange={() => toggleLayer(t.key)} /> {t.label}
              </label>
            ))}
          </div>
          <button type="button" onClick={resetOverview}>Back to overview</button>
        </div>
        <p className="field-help map-status" aria-live="polite">
          {query.trim()
            ? `${matches.length} matching ${matches.length === 1 ? "node" : "nodes"}; non-matching clusters are dimmed.`
            : "Drag nodes, pan/zoom the canvas, double-click an investigation to expand datasets/publications, or Shift-click to compare."}
        </p>

        <div className="map-body">
          <ObsidianKnowledgeGraph
            nodes={index.data.nodes}
            edges={index.data.edges}
            visibleIds={visible}
            highlightIds={highlight}
            selectedId={selected}
            comparingIds={comparing}
            onSelect={setSelected}
            onToggleCompare={toggleCompare}
            onDoubleSelect={toggleExpand}
          />
          <aside className="map-side" aria-label="Selected node">
            {!node && (
              <div className="map-empty">
                <p className="slot-title">Select a node on the Force Canvas</p>
                <p>Hover or click any node to highlight its immediate neighborSet and inspect its verified NASA PSI evidence path.</p>
                <ul className="map-legend">
                  {Object.entries(GRAPH_CLUSTER_COLORS).map(([key, c]) => (
                    <li key={key}>
                      <span className="lg" style={{ background: c.color, borderRadius: "50%" }} aria-hidden="true" />
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {node && (
              <div className="map-detail">
                <p className="eyebrow">{typeLabels[node.type]}{node.group === "fuel" ? ", fuel or material" : ""}</p>
                <h3>{node.title ?? node.label}</h3>
                <p className="map-summary">{nodeSummary(node)}</p>
                <p className="map-actions">
                  {node.type === "investigation" && <a href={detailHref(node.id)} onClick={onLink}>Open the investigation page</a>}
                  {node.url && (
                    <a href={node.url} target="_blank" rel="noreferrer">
                      {node.type === "publication" && node.doi ? "Open the DOI" : "Open on NASA PSI"}
                    </a>
                  )}
                </p>
                <p className="map-actions">
                  {node.type === "investigation" && (
                    <button type="button" onClick={() => toggleExpand(node.id)} aria-pressed={expanded.has(node.id)}>
                      {expanded.has(node.id) ? "Hide publications and datasets" : "Show publications and datasets"}
                    </button>
                  )}
                  <button type="button" onClick={() => toggleCompare(node.id)} aria-pressed={comparing.includes(node.id)}>
                    {comparing.includes(node.id) ? "Remove from compare" : "Add to compare"}
                  </button>
                </p>

                {path.length > 0 && (
                  <>
                    <h4>Evidence path</h4>
                    <ol className="evidence-path">
                      {path.map((e: GEdge) => (
                        <li key={e.id}>
                          <span className="ep-step">{label(e.source)} <span className="ep-rel">{edgeLabels[e.type]}</span> {label(e.target)}</span>
                          <span className="ep-evidence">{e.evidence}. <a href={e.url} target="_blank" rel="noreferrer">Source</a></span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {cross.length > 0 && (
                  <>
                    <h4>Neighbor Links ({cross.length})</h4>
                    <ul className="evidence-path">
                      {cross.slice(0, 12).map((e) => {
                        const other = e.source === node.id ? e.target : e.source;
                        return (
                          <li key={e.id}>
                            <span className="ep-step">
                              <button type="button" className="link-button" onClick={() => setSelected(other)}>{label(other)}</button>{" "}
                              <span className="ep-rel">{e.source === node.id ? edgeLabels[e.type] : `${edgeLabels[e.type]} (incoming)`}</span>
                            </span>
                            <span className="ep-evidence">{e.evidence}. <a href={e.url} target="_blank" rel="noreferrer">Source</a></span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="panel" aria-labelledby="compare-title">
        <h2 id="compare-title">Compare ({comparing.length}/{MAX_COMPARE})</h2>
        {comparing.length === 0 && <p className="field-help">Shift-click nodes on the map, or use “Add to compare”, to compare up to three nodes of the same kind.</p>}
        {comparing.length > 0 && (
          <ul className="chips compare-chips" aria-label="Nodes to compare">
            {comparing.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => toggleCompare(id)} aria-label={`Remove ${label(id)} from compare`}>
                  {label(id)}<span aria-hidden="true"> ×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {result && (
          <>
            {result.notes.length > 0 && (
              <ul className="compat-notes" aria-label="Compatibility checks">
                {result.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            {result.ok && (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparison table">
                <table>
                  <thead><tr><th scope="col">Attribute</th>{comparing.map((id) => <th key={id} scope="col">{label(id)}</th>)}</tr></thead>
                  <tbody>{result.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th>{r.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="nodes-title">
        <h2 id="nodes-title">{matches.length ? `Matching nodes (${matches.length})` : "Investigations"}</h2>
        <ul className="node-list">
          {listed.map((id) => {
            const n = index.nodes.get(id)!;
            return (
              <li key={id}>
                <button type="button" className="link-button" aria-pressed={selected === id} onClick={() => setSelected(id)}>
                  {n.title ?? n.label}
                </button>
                <span className="node-kind">{typeLabels[n.type]}{n.group === "fuel" ? ", fuel" : ""}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
