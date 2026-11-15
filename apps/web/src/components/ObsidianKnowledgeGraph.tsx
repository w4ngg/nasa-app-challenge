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
  onSelect: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
  onDoubleSelect?: (id: string) => void;
}

export function ObsidianKnowledgeGraph({
  nodes,
  edges,
  visibleIds,
  highlightIds,
  selectedId,
  comparingIds,
  onSelect,
  onToggleCompare,
  onDoubleSelect,
}: ObsidianKnowledgeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 1 });
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

  // Sync visible nodes into the physics simulation state
  useEffect(() => {
    const map = simNodesRef.current;
    const shown = nodes.filter((n) => visibleIds.has(n.id));
    shown.forEach((n, idx) => {
      if (!map.has(n.id)) {
        const angle = (idx / Math.max(1, shown.length)) * Math.PI * 2;
        const ring = n.type === "resource" ? 10 : n.type === "program" ? 110 : n.type === "investigation" ? 210 : 300;
        const radius =
          n.type === "investigation"
            ? Math.min(18, 8 + Math.sqrt(n.runs ?? 4) * 0.45)
            : n.type === "program"
              ? 11
              : n.type === "publication"
                ? 5.5
                : 8;
        map.set(n.id, {
          id: n.id,
          label: n.label,
          cluster: classifyCluster(n),
          radius,
          x: Math.cos(angle) * ring + (Math.random() - 0.5) * 24,
          y: Math.sin(angle) * ring + (Math.random() - 0.5) * 24,
          vx: 0,
          vy: 0,
        });
      } else {
        const existing = map.get(n.id)!;
        existing.cluster = classifyCluster(n);
      }
    });
  }, [nodes, visibleIds]);

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
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (viewRef.current.panX === 0 && viewRef.current.panY === 0) {
        viewRef.current.panX = w / 2;
        viewRef.current.panY = h / 2;
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
      for (const n of simNodesRef.current.values()) {
        if (!visibleIds.has(n.id)) continue;
        if (Math.hypot(x - n.x, y - n.y) <= n.radius + 5) return n;
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
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
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
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
        viewRef.current.panX += sx - d.startX;
        viewRef.current.panY += sy - d.startY;
        d.startX = sx;
        d.startY = sy;
        return;
      }
      const hit = findNodeAt(sx, sy);
      setHoveredId(hit ? hit.id : null);
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId) {
        const node = simNodesRef.current.get(d.nodeId);
        if (node) node.pinned = false;
        if (!d.moved) {
          if (e.shiftKey || e.metaKey || e.ctrlKey) onToggleCompare(d.nodeId);
          else onSelect(d.nodeId);
        }
      } else if (d.type === "pan" && !d.moved) {
        onSelect(null);
      }
      dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, moved: false };
    };

    const onDoubleClick = (e: globalThis.MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && onDoubleSelect) onDoubleSelect(hit.id);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.max(0.25, Math.min(3.0, viewRef.current.zoom * factor));
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
      const list: SimNode[] = [];
      for (const n of simNodesRef.current.values()) {
        if (visibleIds.has(n.id)) list.push(n);
      }

      if (!reducedMotion) {
        // 1. Center Gravity + 2. Coulomb Repulsion
        const kGravity = 0.012;
        const kRepulse = 2600;
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a.pinned) {
            a.vx -= a.x * kGravity;
            a.vy -= a.y * kGravity;
          }
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            const dx = b.x - a.x || 0.01;
            const dy = b.y - a.y || 0.01;
            const distSq = Math.max(80, dx * dx + dy * dy);
            const force = kRepulse / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
            if (!b.pinned) { b.vx += fx; b.vy += fy; }
          }
        }

        // 3. Hooke Spring Attraction along edges
        const kSpring = 0.028;
        const restLength = 95;
        for (const e of activeEdges as SimEdge[]) {
          const s = simNodesRef.current.get(e.source);
          const t = simNodesRef.current.get(e.target);
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

        // 4. Damping & Position Integration
        const damping = 0.82;
        for (const n of list) {
          if (n.pinned) continue;
          n.vx *= damping;
          n.vy *= damping;
          n.x += Math.max(-12, Math.min(12, n.vx));
          n.y += Math.max(-12, Math.min(12, n.vy));
        }
      }

      // Render Frame
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(viewRef.current.panX, viewRef.current.panY);
      ctx.scale(viewRef.current.zoom, viewRef.current.zoom);

      const hasFocus = neighborSet.size > 0 || highlightIds.size > 0;
      const isLight = document.documentElement.getAttribute("data-theme") === "carbon-light";

      // Draw Edges
      for (const e of activeEdges) {
        const s = simNodesRef.current.get(e.source);
        const t = simNodesRef.current.get(e.target);
        if (!s || !t) continue;
        const isNeighborEdge = activeId && (e.source === activeId || e.target === activeId);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isNeighborEdge
          ? isLight ? "#0043CE" : "#8FE3FF"
          : isLight ? "rgba(15, 98, 254, 0.26)" : "rgba(79, 168, 255, 0.22)";
        ctx.lineWidth = isNeighborEdge ? 2.0 : 1.0;
        ctx.globalAlpha = hasFocus && !isNeighborEdge ? 0.18 : 0.85;
        ctx.stroke();
      }

      // Draw Nodes
      for (const n of list) {
        const inFocus = !hasFocus || neighborSet.has(n.id) || highlightIds.has(n.id);
        const clusterSpec = GRAPH_CLUSTER_COLORS[n.cluster];
        const color = isLight ? clusterSpec.lightColor : clusterSpec.color;
        ctx.globalAlpha = inFocus ? 1.0 : 0.22;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (n.id === selectedId || comparingIds.includes(n.id)) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = isLight ? "#0F172A" : "#FFFFFF";
          ctx.stroke();
        }

        if (n.radius >= 7 || n.id === selectedId || neighborSet.has(n.id)) {
          ctx.font = "600 10.5px 'Plus Jakarta Sans', sans-serif";
          ctx.fillStyle = isLight ? "#0F172A" : "#F1F5F9";
          ctx.textAlign = "center";
          ctx.fillText(n.label.slice(0, 26), n.x, n.y + n.radius + 13);
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
  }, [activeEdges, activeId, comparingIds, highlightIds, neighborSet, onDoubleSelect, onSelect, onToggleCompare, selectedId, visibleIds]);

  return (
    <div className="obsidian-canvas-wrap">
      <canvas ref={canvasRef} aria-label="Obsidian Force-Directed Knowledge Graph Canvas" />
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

