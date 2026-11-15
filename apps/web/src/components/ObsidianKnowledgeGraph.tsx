import { useEffect, useMemo, useRef, useState } from "react";
import { GRAPH_CLUSTER_COLORS } from "../design/tokens";
import type { GEdge, GNode } from "../lib/graph";

export type ObsidianClusterKey = keyof typeof GRAPH_CLUSTER_COLORS;

interface SimNode {
  id: string;
  label: string;
  type: GNode["type"];
  group?: string;
  cluster: ObsidianClusterKey;
  baseRadius: number;
  currentRadius: number;
  degree: number;
  angleOffset: number;
  x: number;
  y: number;
}

function classifyCluster(n: GNode): ObsidianClusterKey {
  if (n.type === "dataset") return "PSI_CSV";
  if (n.type === "investigation") {
    return (n.o2 ?? []).length > 0 && (n.runs ?? 0) > 0 ? "PSI_CSV" : "BOUNDARY_GAP";
  }
  if (n.type === "concept" && n.group === "fuel") return "FUEL";
  if (n.type === "program" || n.type === "resource") return "HARDWARE";
  return "METADATA_ABS";
}

function computeBaseRadius(n: GNode, degree: number): number {
  if (n.type === "resource") return 19;
  if (n.type === "program") return Math.min(16.5, 11.5 + Math.sqrt(degree) * 1.15);
  if (n.type === "investigation") {
    const runs = n.runs ?? 0;
    return runs > 0 ? Math.min(14.5, 6.8 + Math.sqrt(runs) * 0.45 + Math.min(2.5, degree * 0.15)) : 6.2;
  }
  if (n.type === "concept" && n.group === "fuel") return Math.min(5.2, 3.2 + Math.sqrt(degree) * 0.42);
  if (n.type === "concept") return Math.min(5.8, 3.4 + Math.sqrt(degree) * 0.48);
  return n.type === "dataset" ? 4.2 : 3.5;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/** Draw a sharp, multi-faceted Cosmic Obsidian Crystal shard instead of a glossy circle. */
function drawCosmicCrystal(
  ctx: CanvasRenderingContext2D,
  n: SimNode,
  r: number,
  color: string,
  isPrimary: boolean,
  isNeighbor: boolean,
  isLight: boolean,
) {
  const { x, y, angleOffset, type, group } = n;

  // Faint cosmic starlight aura only for hubs or focused crystals (flat, non-glossy)
  if (r >= 9 || isPrimary || isNeighbor) {
    const auraR = r * (isPrimary ? 2.5 : 1.85);
    const aura = ctx.createRadialGradient(x, y, r * 0.2, x, y, auraR);
    aura.addColorStop(0, hexToRgba(color, isPrimary ? 0.34 : 0.16));
    aura.addColorStop(1, hexToRgba(color, 0));
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fillStyle = aura;
    ctx.fill();
  }

  // Build angular crystal vertices by node hierarchy
  const sides = type === "resource" ? 8 : type === "program" ? 6 : type === "investigation" ? 6 : group === "fuel" ? 4 : 4;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = angleOffset + (i * Math.PI * 2) / sides;
    // Elongate alternate vertices to form sharp mineral crystal shards
    const stretch =
      sides === 6 && type === "investigation"
        ? i % 3 === 0 ? 1.24 : 0.86
        : sides === 4
          ? i % 2 === 0 ? 1.28 : 0.82
          : i % 2 === 0 ? 1.08 : 0.94;
    pts.push({ x: x + Math.cos(a) * r * stretch, y: y + Math.sin(a) * r * stretch });
  }

  // 1. Dark Obsidian mineral base
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = isLight ? "#0F172A" : "#060A15";
  ctx.fill();

  // 2. Internal geometric crystal facets (planar triangular cuts meeting at an off-center ridge apex)
  const apexX = x + Math.cos(angleOffset - 0.7) * r * 0.22;
  const apexY = y + Math.sin(angleOffset - 0.7) * r * 0.22;
  const facetAlphas = [0.68, 0.28, 0.14, 0.46, 0.82, 0.22, 0.54, 0.34];

  for (let i = 0; i < sides; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % sides];
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, facetAlphas[i % facetAlphas.length]);
    ctx.fill();
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = hexToRgba(color, isPrimary ? 0.95 : 0.55);
    ctx.stroke();
  }

  // 3. Sharp crystal outer perimeter ridge
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.lineWidth = isPrimary ? 1.9 : r >= 10 ? 1.35 : 1.0;
  ctx.strokeStyle = isPrimary ? (isLight ? "#0043CE" : "#FFFFFF") : color;
  ctx.stroke();

  // 4. Crisp 4-point starlight diffraction cross on hubs & active nodes
  if (r >= 9.5 || isPrimary) {
    const spike = r * (isPrimary ? 1.75 : 1.35);
    ctx.beginPath();
    ctx.moveTo(x - spike, y);
    ctx.lineTo(x + spike, y);
    ctx.moveTo(x, y - spike);
    ctx.lineTo(x, y + spike);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = hexToRgba(isPrimary ? "#FFFFFF" : color, isPrimary ? 0.75 : 0.4);
    ctx.stroke();
  }

  // 5. Sharp diamond pinpoint nucleus
  const coreR = Math.max(1.4, r * 0.22);
  ctx.beginPath();
  ctx.moveTo(x, y - coreR);
  ctx.lineTo(x + coreR, y);
  ctx.lineTo(x, y + coreR);
  ctx.lineTo(x - coreR, y);
  ctx.closePath();
  ctx.fillStyle = isPrimary || r >= 10 ? "#FFFFFF" : color;
  ctx.fill();

  // 6. Outer wireframe crystal frame when selected/hovered or for Boundary-Gap nodes
  if (isPrimary || n.cluster === "BOUNDARY_GAP") {
    const frameR = r + (isPrimary ? 4.8 : 3.2);
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = angleOffset + (i * Math.PI * 2) / sides;
      const fx = x + Math.cos(a) * frameR;
      const fy = y + Math.sin(a) * frameR;
      if (i === 0) ctx.moveTo(fx, fy);
      else ctx.lineTo(fx, fy);
    }
    ctx.closePath();
    ctx.lineWidth = isPrimary ? 1.2 : 0.8;
    ctx.strokeStyle = hexToRgba(isPrimary ? "#FFFFFF" : color, isPrimary ? 0.85 : 0.45);
    ctx.stroke();
  }
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
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 0.86 });
  const dragRef = useRef<{ type: "node" | "pan" | null; nodeId: string | null; startX: number; startY: number; moved: boolean }>({
    type: null, nodeId: null, startX: 0, startY: 0, moved: false,
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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

  const degreeMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of activeEdges) {
      counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
      counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
    }
    return counts;
  }, [activeEdges]);

  const stateRef = useRef({
    activeEdges, activeId, hoveredId, selectedId, comparingIds, highlightIds,
    neighborSet, visibleIds, onSelect, onToggleCompare, onDoubleSelect,
  });
  stateRef.current = {
    activeEdges, activeId, hoveredId, selectedId, comparingIds, highlightIds,
    neighborSet, visibleIds, onSelect, onToggleCompare, onDoubleSelect,
  };

  // Pre-compute a static, well-spaced Obsidian constellation layout once whenever visible nodes change
  useEffect(() => {
    const map = simNodesRef.current;
    const shown = nodes.filter((n) => visibleIds.has(n.id));
    let needsLayout = false;

    shown.forEach((n, idx) => {
      const deg = degreeMap.get(n.id) ?? 1;
      const baseRadius = computeBaseRadius(n, deg);
      if (!map.has(n.id)) {
        needsLayout = true;
        const h = hashId(n.id);
        const angle = (idx / Math.max(1, shown.length)) * Math.PI * 2 + h * 0.5;
        const ring = n.type === "resource" ? 0 : n.type === "program" ? 150 : n.type === "investigation" ? 280 : 420;
        map.set(n.id, {
          id: n.id,
          label: n.label,
          type: n.type,
          group: n.group,
          cluster: classifyCluster(n),
          baseRadius,
          currentRadius: baseRadius,
          degree: deg,
          angleOffset: h * Math.PI * 2,
          x: ring === 0 ? 0 : Math.cos(angle) * ring + (h - 0.5) * 40,
          y: ring === 0 ? 0 : Math.sin(angle) * ring + (((h * 997) % 1) - 0.5) * 40,
        });
      } else {
        const existing = map.get(n.id)!;
        existing.cluster = classifyCluster(n);
        existing.baseRadius = baseRadius;
        existing.degree = deg;
      }
    });

    if (needsLayout) {
      const list = shown.map((n) => map.get(n.id)!);
      const vx = new Float64Array(list.length);
      const vy = new Float64Array(list.length);
      const idxById = new Map<string, number>();
      list.forEach((n, i) => idxById.set(n.id, i));

      // Synchronous offline relaxation (120 steps) -> 100% static constellation on screen
      for (let step = 0; step < 120; step++) {
        const cooling = 1 - step / 135;
        const kGravity = 0.009 * cooling;
        const kRepulse = 6800 * cooling;
        const kSpring = 0.032 * cooling;

        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.type === "resource") continue;
          vx[i] -= a.x * kGravity;
          vy[i] -= a.y * kGravity;
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
            const minGap = a.baseRadius + b.baseRadius + 28;
            const distSq = Math.max(minGap * minGap * 0.45, dx * dx + dy * dy);
            const force = kRepulse / distSq, dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            vx[i] -= fx; vy[i] -= fy;
            if (b.type !== "resource") { vx[j] += fx; vy[j] += fy; }
          }
        }

        for (const e of activeEdges) {
          const si = idxById.get(e.source), ti = idxById.get(e.target);
          if (si === undefined || ti === undefined) continue;
          const s = list[si], t = list[ti];
          const dx = t.x - s.x, dy = t.y - s.y, dist = Math.max(1, Math.hypot(dx, dy));
          const rest = 145 + (s.baseRadius + t.baseRadius) * 1.8;
          const delta = (dist - rest) * kSpring;
          const fx = (dx / dist) * delta, fy = (dy / dist) * delta;
          if (s.type !== "resource") { vx[si] += fx; vy[si] += fy; }
          if (t.type !== "resource") { vx[ti] -= fx; vy[ti] -= fy; }
        }

        for (let i = 0; i < list.length; i++) {
          if (list[i].type === "resource") { list[i].x = 0; list[i].y = 0; continue; }
          vx[i] *= 0.72; vy[i] *= 0.72;
          list[i].x += Math.max(-18, Math.min(18, vx[i]));
          list[i].y += Math.max(-18, Math.min(18, vy[i]));
        }
      }
    }
  }, [nodes, visibleIds, degreeMap, activeEdges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(320, rect?.width ?? 720), h = Math.max(360, rect?.height ?? 560);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      if (viewRef.current.panX === 0 && viewRef.current.panY === 0) {
        viewRef.current.panX = w / 2; viewRef.current.panY = h / 2;
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
      const vis = stateRef.current.visibleIds;
      let best: SimNode | null = null, bestDist = Infinity;
      for (const n of simNodesRef.current.values()) {
        if (!vis.has(n.id)) continue;
        const d = Math.hypot(x - n.x, y - n.y);
        if (d <= n.currentRadius + 7 && d < bestDist) { best = n; bestDist = d; }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const hit = findNodeAt(sx, sy);
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = hit
        ? { type: "node", nodeId: hit.id, startX: sx, startY: sy, moved: false }
        : { type: "pan", nodeId: null, startX: sx, startY: sy, moved: false };
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId) {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
        const node = simNodesRef.current.get(d.nodeId);
        if (node) {
          const w = screenToWorld(sx, sy);
          node.x = w.x; node.y = w.y;
        }
        return;
      }
      if (d.type === "pan") {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
        viewRef.current.panX += sx - d.startX; viewRef.current.panY += sy - d.startY;
        d.startX = sx; d.startY = sy;
        return;
      }
      const hit = findNodeAt(sx, sy);
      canvas.style.cursor = hit ? "pointer" : "grab";
      const nextId = hit ? hit.id : null;
      if (nextId !== stateRef.current.hoveredId) setHoveredId(nextId);
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId && !d.moved) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) stateRef.current.onToggleCompare(d.nodeId);
        else stateRef.current.onSelect(d.nodeId);
      } else if (d.type === "pan" && !d.moved) stateRef.current.onSelect(null);
      dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, moved: false };
    };

    const onPointerLeave = () => setHoveredId(null);
    const onDoubleClick = (e: globalThis.MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && stateRef.current.onDoubleSelect) stateRef.current.onDoubleSelect(hit.id);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.09 : 0.91;
      const nextZoom = Math.max(0.28, Math.min(3.2, viewRef.current.zoom * factor));
      viewRef.current.panX = sx - ((sx - viewRef.current.panX) / viewRef.current.zoom) * nextZoom;
      viewRef.current.panY = sy - ((sy - viewRef.current.panY) / viewRef.current.zoom) * nextZoom;
      viewRef.current.zoom = nextZoom;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    const drawFrame = () => {
      raf = window.requestAnimationFrame(drawFrame);
      const st = stateRef.current;
      const list: SimNode[] = [];
      for (const n of simNodesRef.current.values()) if (st.visibleIds.has(n.id)) list.push(n);

      for (const n of list) {
        const isHovered = n.id === st.hoveredId;
        const isSelected = n.id === st.selectedId || st.comparingIds.includes(n.id);
        const scale = isHovered ? 1.45 : isSelected ? 1.32 : st.neighborSet.has(n.id) ? 1.15 : st.activeId ? 0.88 : 1.0;
        n.currentRadius += (n.baseRadius * scale - n.currentRadius) * 0.22;
      }

      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      ctx.translate(viewRef.current.panX, viewRef.current.panY);
      ctx.scale(viewRef.current.zoom, viewRef.current.zoom);

      const hasFocus = st.neighborSet.size > 0 || st.highlightIds.size > 0;
      const isLight = document.documentElement.getAttribute("data-theme") === "carbon-light";

      // 1. Draw Static Constellation Filaments
      for (const e of st.activeEdges) {
        const s = simNodesRef.current.get(e.source), t = simNodesRef.current.get(e.target);
        if (!s || !t) continue;
        const isNeighborEdge = Boolean(st.activeId && (e.source === st.activeId || e.target === st.activeId));
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        if (isNeighborEdge) {
          const grad = ctx.createLinearGradient(s.x, s.y, t.x, t.y);
          grad.addColorStop(0, GRAPH_CLUSTER_COLORS[s.cluster][isLight ? "lightColor" : "color"]);
          grad.addColorStop(1, GRAPH_CLUSTER_COLORS[t.cluster][isLight ? "lightColor" : "color"]);
          ctx.strokeStyle = grad; ctx.lineWidth = 1.75; ctx.globalAlpha = 0.92;
        } else {
          ctx.strokeStyle = isLight ? "rgba(15, 98, 254, 0.22)" : "rgba(143, 227, 255, 0.14)";
          ctx.lineWidth = 0.75; ctx.globalAlpha = hasFocus ? 0.08 : 0.48;
        }
        ctx.stroke();
      }

      // 2. Draw Faceted Cosmic Obsidian Crystals
      for (const n of list) {
        const inFocus = !hasFocus || st.neighborSet.has(n.id) || st.highlightIds.has(n.id);
        const isPrimary = n.id === st.hoveredId || n.id === st.selectedId || st.comparingIds.includes(n.id);
        const color = GRAPH_CLUSTER_COLORS[n.cluster][isLight ? "lightColor" : "color"];
        const r = n.currentRadius;
        ctx.globalAlpha = inFocus ? 1.0 : 0.16;

        drawCosmicCrystal(ctx, n, r, color, isPrimary, st.neighborSet.has(n.id), isLight);

        if (r >= 6.5 || isPrimary || (hasFocus && inFocus)) {
          ctx.font = `${isPrimary || r >= 11 ? 600 : 500} ${isPrimary ? 11.5 : 10}px 'Plus Jakarta Sans', sans-serif`;
          ctx.textAlign = "center"; ctx.fillStyle = isLight ? "#0F172A" : "#E2E8F0";
          ctx.fillText(n.label.slice(0, 28), n.x, n.y + r + 13);
        }
      }
      ctx.restore();
    };
    drawFrame();

    return () => {
      window.cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="obsidian-canvas-wrap">
      <canvas ref={canvasRef} aria-label="Obsidian Force-Directed Knowledge Graph Canvas" />
      <div style={{ position: "absolute", left: 12, bottom: 10, display: "flex", flexWrap: "wrap", gap: 6, pointerEvents: "none" }}>
        {Object.entries(GRAPH_CLUSTER_COLORS).map(([key, spec]) => (
          <span key={key} className="obsidian-swatch-pill">
            <span className="obsidian-swatch-dot" style={{ background: spec.color, boxShadow: `0 0 8px ${spec.color}` }} />
            {spec.label}
          </span>
        ))}
      </div>
    </div>
  );
}

