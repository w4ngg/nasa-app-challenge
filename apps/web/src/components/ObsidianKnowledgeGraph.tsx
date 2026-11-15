import { useEffect, useMemo, useRef, useState } from "react";
import { GRAPH_CLUSTER_COLORS } from "../design/tokens";
import type { GEdge, GNode } from "../lib/graph";

export type ObsidianClusterKey = keyof typeof GRAPH_CLUSTER_COLORS;

interface SimNode {
  id: string;
  label: string;
  cluster: ObsidianClusterKey;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
}

interface SimEdge {
  id: string;
  source: string;
  target: string;
}

function classifyCluster(n: GNode): ObsidianClusterKey {
  if (n.type === "dataset") return "PSI_CSV";
  if (n.type === "investigation") {
    const hasO2 = (n.o2 ?? []).length > 0;
    const hasRuns = (n.runs ?? 0) > 0;
    return hasO2 && hasRuns ? "PSI_CSV" : "BOUNDARY_GAP";
  }
  if (n.type === "concept" && n.group === "fuel") return "FUEL";
  if (n.type === "program" || n.type === "resource") return "HARDWARE";
  return "METADATA_ABS";
}

export interface ObsidianKnowledgeGraphProps {
  nodes: GNode[];
  edges: GEdge[];
  visibleIds: Set<string>;
  highlightIds: Set<string>;
  selectedId: string | null;
  comparingIds: string[];
  fitTrigger?: number;
  onSelect: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
  onDoubleSelect?: (id: string) => void;
}

function stepSimulation(
  list: SimNode[],
  nodeMap: Map<string, SimNode>,
  activeEdges: SimEdge[],
  aspect: number,
): void {
  const count = list.length;
  if (count === 0) return;

  // Match horizontal/vertical gravity to the canvas aspect ratio so the constellation spans edge-to-edge.
  const kGravityY = 0.0055;
  const kGravityX = kGravityY / Math.pow(Math.max(1.0, Math.min(2.2, aspect)), 2.1);
  const kRepulse = count > 200 ? 3800 : 5200;
  const restLength = count > 200 ? 112 : 140;
  const kSpring = count > 200 ? 0.015 : 0.011;

  for (let i = 0; i < count; i++) {
    const a = list[i];
    if (!a.pinned) {
      a.vx -= a.x * kGravityX;
      a.vy -= a.y * kGravityY;
    }
    for (let j = i + 1; j < count; j++) {
      const b = list[j];
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const distSq = Math.max(160, dx * dx + dy * dy);
      const force = kRepulse / distSq;
      const dist = Math.sqrt(distSq);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  for (const e of activeEdges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const delta = (dist - restLength) * kSpring;
    const fx = (dx / dist) * delta;
    const fy = (dy / dist) * delta;
    if (!s.pinned) { s.vx += fx; s.vy += fy; }
    if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
  }

  const damping = 0.82;
  for (const n of list) {
    if (n.pinned) continue;
    n.vx *= damping;
    n.vy *= damping;
    n.x += Math.max(-14, Math.min(14, n.vx));
    n.y += Math.max(-14, Math.min(14, n.vy));
  }
}

function computeFitView(list: SimNode[], w: number, h: number): { panX: number; panY: number; zoom: number } | null {
  if (list.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of list) {
    const r = n.radius + 12;
    if (n.x - r < minX) minX = n.x - r;
    if (n.x + r > maxX) maxX = n.x + r;
    if (n.y - r < minY) minY = n.y - r;
    if (n.y + r + 14 > maxY) maxY = n.y + r + 14;
  }
  const padX = 24;
  const padTop = 20;
  const padBottom = 40;
  const availW = Math.max(120, w - padX * 2);
  const availH = Math.max(120, h - padTop - padBottom);
  const spanX = Math.max(120, maxX - minX);
  const spanY = Math.max(120, maxY - minY);
  const zoom = Math.max(0.25, Math.min(3.5, Math.min(availW / spanX, availH / spanY)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    zoom,
    panX: w / 2 - centerX * zoom,
    panY: padTop + availH / 2 - centerY * zoom,
  };
}

export function ObsidianKnowledgeGraph({
  nodes,
  edges,
  visibleIds,
  highlightIds,
  selectedId,
  comparingIds,
  fitTrigger = 0,
  onSelect,
  onToggleCompare,
  onDoubleSelect,
}: ObsidianKnowledgeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 1, initialized: false });
  const autoFitRef = useRef(true);
  const sizeRef = useRef({ w: 900, h: 640 });
  const dragRef = useRef<{
    type: "node" | "pan" | null;
    nodeId: string | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ type: null, nodeId: null, startX: 0, startY: 0, moved: false });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Build neighborSet for active node (selectedId or hoveredId)
  const activeId = hoveredId ?? selectedId;
  const neighborSet = useMemo(() => {
    const set = new Set<string>();
    if (!activeId) return set;
    set.add(activeId);
    for (const e of edges) {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
      if (e.source === activeId) set.add(e.target);
      if (e.target === activeId) set.add(e.source);
    }
    return set;
  }, [activeId, edges, visibleIds]);

  const activeEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );

  // Keep latest render/interaction state in a ref so the canvas loop never tears down on hover/select.
  const stateRef = useRef({
    visibleIds,
    activeEdges,
    activeId,
    neighborSet,
    highlightIds,
    selectedId,
    comparingIds,
    onSelect,
    onToggleCompare,
    onDoubleSelect,
  });
  stateRef.current = {
    visibleIds,
    activeEdges,
    activeId,
    neighborSet,
    highlightIds,
    selectedId,
    comparingIds,
    onSelect,
    onToggleCompare,
    onDoubleSelect,
  };

  // Sync visible nodes into the physics simulation state and warm up newly added batches.
  useEffect(() => {
    const map = simNodesRef.current;
    const shown = nodes.filter((n) => visibleIds.has(n.id));
    let added = 0;
    shown.forEach((n, idx) => {
      if (!map.has(n.id)) {
        added += 1;
        const angle = (idx / Math.max(1, shown.length)) * Math.PI * 2;
        const ring = n.type === "resource" ? 0 : n.type === "program" ? 130 : n.type === "investigation" ? 250 : 380;
        const radius =
          n.type === "investigation"
            ? Math.min(20, 9.5 + Math.sqrt(n.runs ?? 4) * 0.5)
            : n.type === "program"
              ? 12
              : n.type === "publication"
                ? 5.5
                : 8.5;
        map.set(n.id, {
          id: n.id,
          label: n.label,
          cluster: classifyCluster(n),
          radius,
          x: Math.cos(angle) * ring * 1.4 + (Math.random() - 0.5) * 28,
          y: Math.sin(angle) * ring * 0.85 + (Math.random() - 0.5) * 20,
          vx: 0,
          vy: 0,
        });
      } else {
        const existing = map.get(n.id)!;
        existing.cluster = classifyCluster(n);
      }
    });

    if (added >= 5) {
      const list = shown.map((n) => map.get(n.id)!).filter(Boolean);
      const aspect = sizeRef.current.w / Math.max(1, sizeRef.current.h);
      for (let step = 0; step < 120; step++) {
        stepSimulation(list, map, activeEdges, aspect);
      }
      autoFitRef.current = true;
      viewRef.current.initialized = false;
    }
  }, [activeEdges, nodes, visibleIds]);

  const snapFitToCanvas = () => {
    autoFitRef.current = true;
    const list: SimNode[] = [];
    for (const n of simNodesRef.current.values()) {
      if (stateRef.current.visibleIds.has(n.id)) list.push(n);
    }
    const fit = computeFitView(list, sizeRef.current.w, sizeRef.current.h);
    if (fit) {
      viewRef.current = { ...fit, initialized: true };
    }
  };

  useEffect(() => {
    if (fitTrigger > 0) snapFitToCanvas();
  }, [fitTrigger]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(320, rect?.width ?? 720);
      const h = Math.max(360, rect?.height ?? 560);
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (autoFitRef.current) {
        const list: SimNode[] = [];
        for (const n of simNodesRef.current.values()) {
          if (stateRef.current.visibleIds.has(n.id)) list.push(n);
        }
        const fit = computeFitView(list, w, h);
        if (fit) {
          viewRef.current = { ...fit, initialized: true };
          return;
        }
      }
      if (!viewRef.current.initialized) {
        viewRef.current = { panX: w / 2, panY: h / 2, zoom: 1, initialized: true };
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - viewRef.current.panX) / viewRef.current.zoom,
      y: (sy - viewRef.current.panY) / viewRef.current.zoom,
    });

    const findNodeAt = (sx: number, sy: number): SimNode | null => {
      const { x, y } = screenToWorld(sx, sy);
      const pad = 6 / Math.max(0.35, viewRef.current.zoom);
      for (const n of simNodesRef.current.values()) {
        if (!stateRef.current.visibleIds.has(n.id)) continue;
        if (Math.hypot(x - n.x, y - n.y) <= n.radius + pad) return n;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = findNodeAt(sx, sy);
      canvas.setPointerCapture(e.pointerId);
      if (hit) {
        hit.pinned = true;
        dragRef.current = { type: "node", nodeId: hit.id, startX: sx, startY: sy, moved: false };
      } else {
        dragRef.current = { type: "pan", nodeId: null, startX: sx, startY: sy, moved: false };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const d = dragRef.current;

      if (d.type === "node" && d.nodeId) {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) {
          d.moved = true;
          autoFitRef.current = false;
        }
        const node = simNodesRef.current.get(d.nodeId);
        if (node) {
          const w = screenToWorld(sx, sy);
          node.x = w.x;
          node.y = w.y;
          node.vx = 0;
          node.vy = 0;
        }
        return;
      }
      if (d.type === "pan") {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) {
          d.moved = true;
          autoFitRef.current = false;
        }
        viewRef.current.panX += sx - d.startX;
        viewRef.current.panY += sy - d.startY;
        d.startX = sx;
        d.startY = sy;
        return;
      }
      const hit = findNodeAt(sx, sy);
      setHoveredId((prev) => (prev === (hit?.id ?? null) ? prev : (hit?.id ?? null)));
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId) {
        const node = simNodesRef.current.get(d.nodeId);
        if (node) node.pinned = false;
        if (!d.moved) {
          if (e.shiftKey || e.metaKey || e.ctrlKey) stateRef.current.onToggleCompare(d.nodeId);
          else stateRef.current.onSelect(d.nodeId);
        }
      } else if (d.type === "pan" && !d.moved) {
        stateRef.current.onSelect(null);
      }
      dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, moved: false };
    };

    const onDoubleClick = (e: globalThis.MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && stateRef.current.onDoubleSelect) stateRef.current.onDoubleSelect(hit.id);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoFitRef.current = false;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.max(0.2, Math.min(4.0, viewRef.current.zoom * factor));
      viewRef.current.panX = sx - ((sx - viewRef.current.panX) / viewRef.current.zoom) * nextZoom;
      viewRef.current.panY = sy - ((sy - viewRef.current.panY) / viewRef.current.zoom) * nextZoom;
      viewRef.current.zoom = nextZoom;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    const stepPhysicsAndDraw = () => {
      raf = window.requestAnimationFrame(stepPhysicsAndDraw);
      const st = stateRef.current;
      const list: SimNode[] = [];
      for (const n of simNodesRef.current.values()) {
        if (st.visibleIds.has(n.id)) list.push(n);
      }

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      if (!reducedMotion) {
        stepSimulation(list, simNodesRef.current, st.activeEdges as SimEdge[], w / Math.max(1, h));
      }

      if (autoFitRef.current && list.length > 0) {
        const fit = computeFitView(list, w, h);
        if (fit) {
          if (!viewRef.current.initialized) {
            viewRef.current = { ...fit, initialized: true };
          } else {
            const ease = 0.14;
            viewRef.current.panX += (fit.panX - viewRef.current.panX) * ease;
            viewRef.current.panY += (fit.panY - viewRef.current.panY) * ease;
            viewRef.current.zoom += (fit.zoom - viewRef.current.zoom) * ease;
          }
        }
      }

      // Render Frame
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(viewRef.current.panX, viewRef.current.panY);
      ctx.scale(viewRef.current.zoom, viewRef.current.zoom);

      const hasFocus = st.neighborSet.size > 0 || st.highlightIds.size > 0;
      const isLight = document.documentElement.getAttribute("data-theme") === "carbon-light";
      const zoom = viewRef.current.zoom;
      const radiusScale = 1 / Math.pow(Math.max(0.4, Math.min(1.6, zoom)), 0.45);
      const screenFontPx = Math.max(9.5, Math.min(12.5, 11 * Math.pow(Math.max(0.35, zoom), 0.18)));
      const labelFontSize = screenFontPx / Math.max(0.25, zoom);

      // Draw Edges
      for (const e of st.activeEdges) {
        const s = simNodesRef.current.get(e.source);
        const t = simNodesRef.current.get(e.target);
        if (!s || !t) continue;
        const isNeighborEdge = st.activeId && (e.source === st.activeId || e.target === st.activeId);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isNeighborEdge
          ? isLight ? "#0043CE" : "#8FE3FF"
          : isLight ? "rgba(15, 98, 254, 0.28)" : "rgba(79, 168, 255, 0.26)";
        ctx.lineWidth = (isNeighborEdge ? 2.0 : 1.0) / Math.max(0.45, Math.min(1.5, zoom));
        ctx.globalAlpha = hasFocus && !isNeighborEdge ? 0.24 : 0.85;
        ctx.stroke();
      }

      // Draw Nodes
      for (const n of list) {
        const inFocus = !hasFocus || st.neighborSet.has(n.id) || st.highlightIds.has(n.id);
        const clusterSpec = GRAPH_CLUSTER_COLORS[n.cluster];
        const color = isLight ? clusterSpec.lightColor : clusterSpec.color;
        ctx.globalAlpha = inFocus ? 1.0 : 0.36;

        const r = n.radius * radiusScale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (n.id === st.selectedId || st.comparingIds.includes(n.id)) {
          ctx.lineWidth = 2.6 / Math.max(0.45, zoom);
          ctx.strokeStyle = isLight ? "#0F172A" : "#FFFFFF";
          ctx.stroke();
        }

        if (n.radius >= 8 || n.id === st.selectedId || st.neighborSet.has(n.id)) {
          ctx.font = `600 ${labelFontSize.toFixed(1)}px 'Plus Jakarta Sans', sans-serif`;
          ctx.fillStyle = isLight ? "#0F172A" : "#F1F5F9";
          ctx.textAlign = "center";
          ctx.fillText(n.label.slice(0, 26), n.x, n.y + r + labelFontSize + 2 / zoom);
        }
      }
      ctx.restore();
    };
    stepPhysicsAndDraw();

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="obsidian-canvas-wrap">
      <canvas ref={canvasRef} aria-label="Obsidian Force-Directed Knowledge Graph Canvas" />
      <button
        type="button"
        className="obsidian-fit-btn"
        onClick={snapFitToCanvas}
        title="Scale graph to fill the canvas"
      >
        Fit to screen
      </button>
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        {Object.entries(GRAPH_CLUSTER_COLORS).map(([key, spec]) => (
          <span key={key} className="obsidian-swatch-pill">
            <span className="obsidian-swatch-dot" style={{ background: spec.color }} />
            {spec.label}
          </span>
        ))}
      </div>
    </div>
  );
}

