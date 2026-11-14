import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { compare, edgeLabels, GraphIndex, loadGraph, typeLabels } from "../lib/graph";
import type { GEdge, GNode } from "../lib/graph";
import { percentRange } from "../lib/labels";
import { emptyFilters } from "../lib/filters";
import { routeUrl } from "../lib/route";

type Toggle = "publication" | "dataset" | "concept" | "fuel";
const TOGGLES: { key: Toggle; label: string }[] = [
  { key: "concept", label: "Concepts" },
  { key: "fuel", label: "Fuels and materials" },
  { key: "publication", label: "Publications" },
  { key: "dataset", label: "Datasets" },
];
const MAX_COMPARE = 3;
const FIT_MAX_ZOOM = 1.1;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const detailHref = (id: string) => routeUrl({ view: "map", id, filters: emptyFilters, page: 0 });

const STYLE: StylesheetJson = [
  { selector: "node", style: {
    label: "data(label)", "font-family": "DM Sans, system-ui, sans-serif", "font-size": 10, color: "#161616",
    "text-valign": "bottom", "text-margin-y": 4, "min-zoomed-font-size": 7, "background-color": "#a8a8a8",
    width: 10, height: 10, "text-max-width": "120px", "text-wrap": "ellipsis", "overlay-opacity": 0,
  } },
  { selector: "node[type='resource']", style: { shape: "round-rectangle", "background-color": "#161616", width: 26, height: 26, "font-size": 12, "font-weight": 600 } },
  { selector: "node[type='program']", style: { shape: "round-rectangle", "background-color": "#393939", width: 18, height: 18, "font-size": 12, "font-weight": 600 } },
  { selector: "node[type='investigation']", style: { "background-color": "#0f62fe", width: "mapData(runs, 0, 470, 16, 34)", height: "mapData(runs, 0, 470, 16, 34)", "font-size": 11, "font-weight": 600 } },
  { selector: "node[type='concept'][group='phenomenon']", style: { shape: "diamond", "background-color": "#78a9ff", width: 20, height: 20, "font-size": 11 } },
  { selector: "node[type='concept'][group='fuel']", style: { shape: "tag", "background-color": "#d0e2ff", "border-width": 1, "border-color": "#78a9ff", width: 12, height: 12 } },
  { selector: "node[type='publication']", style: { width: 7, height: 7, "background-color": "#8d8d8d", "text-opacity": 0 } },
  { selector: "node[type='dataset']", style: { shape: "rectangle", "background-color": "#ffffff", "border-width": 2, "border-color": "#0f62fe", width: 11, height: 11, "font-size": 9 } },
  { selector: "edge", style: { width: 1, "line-color": "#c6c6c6", "curve-style": "haystack", opacity: 0.7 } },
  { selector: "edge[type='studies'], edge[type='uses_fuel']", style: { "line-color": "#a6c8ff" } },
  { selector: ".hidden", style: { display: "none" } },
  { selector: ".faded", style: { opacity: 0.12, "text-opacity": 0 } },
  { selector: "node.dim", style: { opacity: 0.35 } },
  { selector: "edge.dim", style: { opacity: 0.15 } },
  { selector: "edge.near", style: { "line-color": "#78a9ff", width: 2, opacity: 1 } },
  { selector: "node.match", style: { "border-width": 3, "border-color": "#161616", "text-opacity": 1, "z-index": 10 } },
  { selector: "node.context", style: { "text-opacity": 1 } },
  { selector: "node.selected", style: { "border-width": 4, "border-color": "#0f62fe", "text-opacity": 1, "z-index": 20, "font-weight": 600 } },
  { selector: "node.comparing", style: { "border-width": 5, "border-style": "double", "border-color": "#161616", "text-opacity": 1 } },
  { selector: "edge.path", style: { "line-color": "#0f62fe", width: 3, opacity: 1, "z-index": 15 } },
];

/** Fit `eles` in view, never closer than FIT_MAX_ZOOM so labels of a tight cluster stay readable. */
function flyTo(cy: Core, eles: cytoscape.NodeCollection, instant: boolean) {
  const bb = eles.boundingBox();
  const pad = 60;
  const level = Math.min(FIT_MAX_ZOOM, (cy.width() - 2 * pad) / Math.max(bb.w, 1), (cy.height() - 2 * pad) / Math.max(bb.h, 1));
  const pan = { x: cy.width() / 2 - level * (bb.x1 + bb.w / 2), y: cy.height() / 2 - level * (bb.y1 + bb.h / 2) };
  cy.stop(true, false);
  if (instant || reducedMotion()) cy.viewport({ zoom: level, pan });
  else cy.animate({ zoom: level, pan, duration: 500, easing: "ease-in-out-cubic" });
}

/**
 * After a drag, push away nodes that overlap the dropped one, and let each pushed node
 * push its own neighbours in turn. Positions are solved first, then animated in one step.
 */
function separate(cy: Core, moved: cytoscape.NodeSingular) {
  const shown = cy.nodes().filter((n) => !n.hasClass("hidden"));
  const pos = new Map<string, { x: number; y: number }>();
  shown.forEach((n) => { pos.set(n.id(), { ...n.position() }); });
  const size = (n: cytoscape.NodeSingular) => Math.max(n.width(), n.height());
  const gap = (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular) => (size(a) + size(b)) / 2 + 28; // room for labels
  const queue = [moved];
  const changed = new Set<string>();
  for (let step = 0; queue.length && step < 120; step++) {
    const a = queue.shift()!;
    const pa = pos.get(a.id())!;
    shown.forEach((b) => {
      if (b.same(a) || b.same(moved)) return;
      const pb = pos.get(b.id())!;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let d = Math.hypot(dx, dy);
      const min = gap(a, b);
      if (d >= min) return;
      if (d < 0.01) { dx = Math.cos(step); dy = Math.sin(step); d = 1; }
      pos.set(b.id(), { x: pa.x + (dx / d) * min, y: pa.y + (dy / d) * min });
      changed.add(b.id());
      queue.push(b);
    });
  }
  changed.forEach((id) => {
    const node = cy.getElementById(id);
    if (reducedMotion()) node.position(pos.get(id)!);
    else node.animate({ position: pos.get(id)! }, { duration: 250, easing: "ease-out-cubic" });
  });
}

function nodeSummary(n: GNode): string {
  if (n.type === "investigation") {
    const ch = (n.o2 ?? []).filter((o) => o.basis === "ambient");
    const o2 = ch.length ? `, chamber O₂ ${percentRange(Math.min(...ch.map((o) => o.min_percent)), Math.max(...ch.map((o) => o.max_percent)))}` : "";
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
  const [shown, setShown] = useState<Set<Toggle>>(new Set(["concept"]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const firstLayout = useRef(true);

  useEffect(() => { loadGraph().then((g) => setIndex(new GraphIndex(g))).catch(() => setFailed(true)); }, []);

  const matches = useMemo(() => {
    if (!index) return [] as string[];
    return index.search(query).filter((id) => {
      const n = index.nodes.get(id)!;
      return n.type !== "resource";
    });
  }, [index, query]);

  // What is on screen: the backbone, toggled layers, expanded investigations, and every match with its ancestors.
  const { visible, highlight } = useMemo(() => {
    const visible = new Set<string>();
    const highlight = new Set<string>();
    if (!index) return { visible, highlight };
    for (const n of index.data.nodes) {
      const layer = n.type === "concept" ? (n.group === "fuel" ? "fuel" : "concept") : n.type;
      if (["resource", "program", "investigation"].includes(n.type) || shown.has(layer as Toggle)) visible.add(n.id);
    }
    for (const id of expanded) for (const c of index.children(id)) visible.add(c.id);
    for (const id of matches) {
      visible.add(id);
      highlight.add(id);
      for (const a of index.ancestors(id)) { visible.add(a); highlight.add(a); }
      if (index.nodes.get(id)?.type === "concept") {
        for (const e of index.into.get(id) ?? []) if (index.nodes.get(e.source)?.type === "investigation") highlight.add(e.source);
      }
    }
    if (selected) visible.add(selected);
    for (const id of comparing) visible.add(id);
    return { visible, highlight };
  }, [index, shown, expanded, matches, selected, comparing]);

  // Stable key of the visible set: the layout reruns only when nodes appear or disappear,
  // not when a selection or highlight changes.
  const visibleKey = useMemo(() => [...visible].sort().join("|"), [visible]);
  const searchingRef = useRef(false);
  searchingRef.current = matches.length > 0;

  // Create the graph once.
  useEffect(() => {
    if (!index || !box.current || cyRef.current) return;
    const elements: ElementDefinition[] = [
      ...index.data.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type, group: n.group ?? "", runs: n.runs ?? 0 } })),
      ...index.data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, type: e.type } })),
    ];
    const cy = cytoscape({
      container: box.current, elements, style: STYLE, minZoom: 0.15, maxZoom: 3, wheelSensitivity: 0.3,
      // Smooth pan and zoom: draw a cached texture and skip edges while the viewport moves.
      textureOnViewport: true, hideEdgesOnViewport: true, motionBlur: false, pixelRatio: "auto",
    });
    cy.on("dragfree", "node", (event) => separate(cy, event.target as cytoscape.NodeSingular));
    cy.on("tap", "node", (event) => {
      const id = event.target.id() as string;
      const original = event.originalEvent as globalThis.MouseEvent | undefined;
      if (original && (original.shiftKey || original.ctrlKey || original.metaKey)) toggleCompare(id);
      else setSelected(id);
    });
    cy.on("dbltap", "node[type='investigation']", (event) => toggleExpand(event.target.id() as string));
    cy.on("tap", (event) => { if (event.target === cy) setSelected(null); });
    cyRef.current = cy;
    if (import.meta.env.DEV) (window as unknown as { __cy?: Core }).__cy = cy; // inspection in development only
    const resize = new ResizeObserver(() => cy.resize());
    resize.observe(box.current);
    return () => { resize.disconnect(); cy.destroy(); cyRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Structure: show or hide nodes and lay out again. Runs only when the visible set changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !index) return;
    // New nodes start on a ring around a visible parent, so the layout settles instead of piling them up.
    const ring = new Map<string, number>();
    const appearing = cy.nodes().filter((n) => visible.has(n.id()) && n.hasClass("hidden"));
    const ringSize = new Map<string, number>();
    appearing.forEach((n) => {
      const p = index.parents(n.id()).map((e) => e.source).find((s) => visible.has(s));
      if (p) ringSize.set(p, (ringSize.get(p) ?? 0) + 1);
    });
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const id = node.id();
        const isVisible = visible.has(id);
        if (isVisible && node.hasClass("hidden")) {
          const parentId = index.parents(id).map((e) => e.source).find((s) => visible.has(s));
          const parent = parentId ? cy.getElementById(parentId) : null;
          if (parent && parentId) {
            const i = ring.get(parentId) ?? 0;
            ring.set(parentId, i + 1);
            const n = ringSize.get(parentId) ?? 1;
            const angle = (2 * Math.PI * i) / n;
            const radius = 90 + n * 6;
            node.position({ x: parent.position("x") + radius * Math.cos(angle), y: parent.position("y") + radius * Math.sin(angle) });
          }
        }
        node.toggleClass("hidden", !isVisible);
      });
    });
    const first = firstLayout.current;
    firstLayout.current = false;
    // The first layout is instant; later ones glide from the current positions (skipped for reduced motion).
    const glide = !first && !reducedMotion() && document.visibilityState === "visible";
    const shown = cy.nodes().filter((n) => visible.has(n.id()));
    const layout = shown.union(shown.edgesWith(shown)).layout({
      name: "cose", animate: glide ? "end" : false, animationDuration: 400, animationEasing: "ease-out-cubic",
      randomize: first, fit: false,
      // Small nodes (publications, datasets) need more push and longer edges to keep their labels apart.
      nodeRepulsion: (n: cytoscape.NodeSingular) => (["publication", "dataset"].includes(n.data("type")) ? 900000 : 400000),
      idealEdgeLength: (e: cytoscape.EdgeSingular) => (["lists_publication", "has_dataset"].includes(e.data("type")) ? 140 : 90),
      edgeElasticity: () => 100, nodeOverlap: 40,
      gravity: 60, numIter: first ? 1200 : 400, initialTemp: first ? 200 : 40,
      coolingFactor: 0.95, minTemp: 1, componentSpacing: 80, padding: 30,
    } as cytoscape.LayoutOptions);
    let done = false;
    const frame = () => {
      if (done) return;
      done = true;
      // Fly the camera to the matches (search) or to everything that is shown.
      const target = searchingRef.current ? cy.nodes(".match") : shown;
      flyTo(cy, target.nonempty() ? target : shown, first);
    };
    layout.one("layoutstop", frame);
    // A hidden tab pauses animation frames, so do not wait for the event forever.
    window.setTimeout(frame, glide ? 900 : 0);
    layout.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, visibleKey]);

  // Highlight: search matches, selection, its neighbours and evidence path. Never moves nodes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !index) return;
    const searching = matches.length > 0;
    const sel = selected ? cy.getElementById(selected) : null;
    const near = new Set<string>();
    if (sel?.nonempty()) sel.neighborhood("node").forEach((n) => { near.add(n.id()); });
    const path = new Set(selected ? index.evidencePath(selected).map((e) => e.id) : []);
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const id = node.id();
        const focus = searching ? highlight.has(id) : !selected || id === selected || near.has(id);
        node.toggleClass("match", matches.includes(id));
        node.toggleClass("context", (highlight.has(id) && !matches.includes(id)) || near.has(id));
        node.toggleClass("faded", searching && !highlight.has(id) && id !== selected && !near.has(id));
        node.toggleClass("dim", !searching && !focus);
        node.toggleClass("selected", id === selected);
        node.toggleClass("comparing", comparing.includes(id));
      });
      cy.edges().forEach((edge) => {
        const s = edge.data("source") as string;
        const t = edge.data("target") as string;
        const touchesSelection = selected !== null && (s === selected || t === selected);
        edge.toggleClass("faded", searching && !(highlight.has(s) && highlight.has(t)) && !touchesSelection);
        edge.toggleClass("dim", !searching && selected !== null && !touchesSelection && !path.has(edge.id()));
        edge.toggleClass("near", touchesSelection && !path.has(edge.id()));
        edge.toggleClass("path", path.has(edge.id()));
      });
    });
    // Keep the camera still; slide only when the selected node is off screen.
    if (sel?.nonempty() && !sel.hasClass("hidden")) {
      const p = sel.renderedPosition();
      const margin = 40;
      if (p.x < margin || p.y < margin || p.x > cy.width() - margin || p.y > cy.height() - margin) {
        cy.stop(true, false);
        if (reducedMotion()) cy.center(sel);
        else cy.animate({ center: { eles: sel }, duration: 350, easing: "ease-in-out-cubic" });
      }
    }
  }, [index, visibleKey, highlight, matches, selected, comparing]);

  function toggleCompare(id: string) {
    setComparing((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? [...c.slice(1), id] : [...c, id]));
  }
  function toggleExpand(id: string) {
    setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function overview() {
    setQuery(""); setSelected(null); setExpanded(new Set());
  }
  function toggleLayer(key: Toggle) {
    setShown((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  if (failed) return <div className="state" role="alert"><h1 className="state-title">The knowledge map could not be loaded</h1><button type="button" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!index) return <p className="state" role="status">Loading the knowledge map…</p>;

  const node = selected ? index.nodes.get(selected) : undefined;
  const path = selected ? index.evidencePath(selected) : [];
  const cross = selected ? index.crossLinks(selected) : [];
  const result = comparing.length >= 2 ? compare(index, comparing) : null;
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const listed = (matches.length ? matches : index.data.nodes.filter((n) => n.type === "investigation").map((n) => n.id)).slice(0, 60);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Knowledge map</h1>
        <p>
          NASA PSI combustion research as a graph: programs, investigations, publications, datasets and the scientific concepts they study.
          Every link carries its evidence. Search to bring the matching branches forward; select a node to see the path back to its source.
        </p>
      </header>

      <section className="panel map-panel" aria-labelledby="map-title">
        <h2 id="map-title" className="sr-only">Graph</h2>
        <div className="map-toolbar">
          <div className="map-search" role="search">
            <label htmlFor="map-search" className="sr-only">Search the knowledge map</label>
            <input id="map-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: smoke detection, PMMA, FLEX, an author or a DOI" />
          </div>
          <div className="map-layers" role="group" aria-label="Layers">
            {TOGGLES.map((t) => (
              <label key={t.key} htmlFor={`layer-${t.key}`} className="check-inline">
                <input id={`layer-${t.key}`} type="checkbox" checked={shown.has(t.key)} onChange={() => toggleLayer(t.key)} /> {t.label}
              </label>
            ))}
          </div>
          <button type="button" onClick={overview}>Back to overview</button>
        </div>
        <p className="field-help map-status" aria-live="polite">
          {query.trim() ? `${matches.length} matching ${matches.length === 1 ? "node" : "nodes"}; the rest is dimmed.` : "Double-click an investigation to show its publications and datasets. Shift-click nodes to compare them."}
        </p>

        <div className="map-body">
          <div ref={box} className="map-canvas" role="img" aria-label="Knowledge graph. Use the node list below to explore with a keyboard." />
          <aside className="map-side" aria-label="Selected node">
            {!node && (
              <div className="map-empty">
                <p className="slot-title">Select a node</p>
                <p>Its details, the evidence path back to NASA PSI, and the concepts it links to appear here.</p>
                <ul className="map-legend">
                  <li><span className="lg lg-program" aria-hidden="true" />Program</li>
                  <li><span className="lg lg-investigation" aria-hidden="true" />Investigation (size: experiment-table rows)</li>
                  <li><span className="lg lg-concept" aria-hidden="true" />Concept</li>
                  <li><span className="lg lg-fuel" aria-hidden="true" />Fuel or material</li>
                  <li><span className="lg lg-publication" aria-hidden="true" />Publication</li>
                  <li><span className="lg lg-dataset" aria-hidden="true" />Dataset</li>
                </ul>
                <p className="field-help">Finding nodes are not built yet: they need full-text sources with page numbers.</p>
              </div>
            )}
            {node && (
              <div className="map-detail">
                <p className="eyebrow">{typeLabels[node.type]}{node.group === "fuel" ? ", fuel or material" : ""}</p>
                <h3>{node.title ?? node.label}</h3>
                {nodeSummary(node) && node.title !== nodeSummary(node) && <p className="map-summary">{nodeSummary(node)}</p>}
                <p className="map-actions">
                  {node.type === "investigation" && <a href={detailHref(node.id)} onClick={onLink}>Open the investigation page</a>}
                  {node.url && <a href={node.url} target="_blank" rel="noreferrer">{node.type === "publication" && node.doi ? "Open the DOI" : "Open on NASA PSI"}</a>}
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
                    <h4>Links ({cross.length})</h4>
                    <ul className="evidence-path">
                      {cross.slice(0, 15).map((e) => {
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
                    {cross.length > 15 && <p className="field-help">{cross.length - 15} more links; search for this concept to see them on the map.</p>}
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
            {comparing.map((id) => <li key={id}><button type="button" onClick={() => toggleCompare(id)} aria-label={`Remove ${label(id)} from compare`}>{label(id)}<span aria-hidden="true"> ×</span></button></li>)}
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
        <p className="field-help">The same nodes as the map, for keyboard and screen-reader use. Selecting one selects it on the map.</p>
        <ul className="node-list">
          {listed.map((id) => {
            const n = index.nodes.get(id)!;
            return (
              <li key={id}>
                <button type="button" className="link-button" aria-pressed={selected === id} onClick={() => setSelected(id)}>{n.title ?? n.label}</button>
                <span className="node-kind">{typeLabels[n.type]}{n.group === "fuel" ? ", fuel" : ""}</span>
              </li>
            );
          })}
        </ul>
        {matches.length > listed.length && <p className="field-help">Showing the first {listed.length}; refine the search to narrow it.</p>}
      </section>
    </div>
  );
}
