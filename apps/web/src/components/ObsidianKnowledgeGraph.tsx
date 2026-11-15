import { useEffect, useMemo, useRef, useState } from "react";
import { GRAPH_CLUSTER_COLORS } from "../design/tokens";
import type { GEdge, GNode } from "../lib/graph";

export type ObsidianClusterKey = keyof typeof GRAPH_CLUSTER_COLORS;

interface SimNode {
  id: string; label: string; type: GNode["type"]; cluster: ObsidianClusterKey;
  baseRadius: number; currentRadius: number; degree: number;
  x: number; y: number; vx: number; vy: number; pinned?: boolean;
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
  if (n.type === "resource") return 24;
  if (n.type === "program") return Math.min(20, 13.5 + Math.sqrt(degree) * 1.35);
  if (n.type === "investigation") {
    const runs = n.runs ?? 0;
    return runs > 0 ? Math.min(19, 8.5 + Math.sqrt(runs) * 0.58 + Math.min(3, degree * 0.18)) : 7.5;
  }
  if (n.type === "concept" && n.group === "fuel") return Math.min(7.2, 4.0 + Math.sqrt(degree) * 0.65);
  if (n.type === "concept") return Math.min(8.0, 4.4 + Math.sqrt(degree) * 0.72);
  return n.type === "dataset" ? 5.2 : 4.2;
}

function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

export interface ObsidianKnowledgeGraphProps {
  nodes: GNode[]; edges: GEdge[]; visibleIds: Set<string>; highlightIds: Set<string>;
  selectedId: string | null; comparingIds: string[];
  onSelect: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
  onDoubleSelect?: (id: string) => void;
}

export function ObsidianKnowledgeGraph({
  nodes, edges, visibleIds, highlightIds, selectedId, comparingIds,
  onSelect, onToggleCompare, onDoubleSelect,
}: ObsidianKnowledgeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 0.92 });
  const alphaRef = useRef(0.55);
  const pointerWorldRef = useRef({ x: 0, y: 0, active: false });
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

  useEffect(() => {
    const map = simNodesRef.current;
    const shown = nodes.filter((n) => visibleIds.has(n.id));
    let addedCount = 0;
    shown.forEach((n, idx) => {
      const deg = degreeMap.get(n.id) ?? 1;
      const baseRadius = computeBaseRadius(n, deg);
      if (!map.has(n.id)) {
        addedCount++;
        const angle = (idx / Math.max(1, shown.length)) * Math.PI * 2 + (idx % 5) * 0.18;
        const ring = n.type === "resource" ? 0 : n.type === "program" ? 130 : n.type === "investigation" ? 250 : 370;
        map.set(n.id, {
          id: n.id, label: n.label, type: n.type, cluster: classifyCluster(n),
          baseRadius, currentRadius: baseRadius, degree: deg,
          x: ring === 0 ? 0 : Math.cos(angle) * ring + (Math.random() - 0.5) * 28,
          y: ring === 0 ? 0 : Math.sin(angle) * ring + (Math.random() - 0.5) * 28,
          vx: 0, vy: 0,
        });
      } else {
        const existing = map.get(n.id)!;
        existing.cluster = classifyCluster(n);
        existing.baseRadius = baseRadius;
        existing.degree = deg;
      }
    });
    if (addedCount > 0) alphaRef.current = Math.max(alphaRef.current, 0.35);
  }, [nodes, visibleIds, degreeMap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
        if (d <= n.currentRadius + 6 && d < bestDist) { best = n; bestDist = d; }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const hit = findNodeAt(sx, sy);
      canvas.setPointerCapture(e.pointerId);
      if (hit) {
        hit.pinned = true; alphaRef.current = Math.max(alphaRef.current, 0.38);
        dragRef.current = { type: "node", nodeId: hit.id, startX: sx, startY: sy, moved: false };
      } else {
        dragRef.current = { type: "pan", nodeId: null, startX: sx, startY: sy, moved: false };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const w = screenToWorld(sx, sy);
      pointerWorldRef.current = { x: w.x, y: w.y, active: true };
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId) {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
        const node = simNodesRef.current.get(d.nodeId);
        if (node) { node.x = w.x; node.y = w.y; node.vx = 0; node.vy = 0; alphaRef.current = Math.max(alphaRef.current, 0.32); }
        return;
      }
      if (d.type === "pan") {
        if (Math.hypot(sx - d.startX, sy - d.startY) > 3) d.moved = true;
        viewRef.current.panX += sx - d.startX; viewRef.current.panY += sy - d.startY;
        d.startX = sx; d.startY = sy;
        return;
      }
      const hit = findNodeAt(sx, sy);
      canvas.style.cursor = hit ? "grab" : "default";
      const nextId = hit ? hit.id : null;
      if (nextId !== stateRef.current.hoveredId) {
        setHoveredId(nextId);
        if (nextId) alphaRef.current = Math.max(alphaRef.current, 0.14);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.type === "node" && d.nodeId) {
        const node = simNodesRef.current.get(d.nodeId);
        if (node) node.pinned = false;
        if (!d.moved) {
          alphaRef.current = Math.max(alphaRef.current, 0.22);
          if (e.shiftKey || e.metaKey || e.ctrlKey) stateRef.current.onToggleCompare(d.nodeId);
          else stateRef.current.onSelect(d.nodeId);
        }
      } else if (d.type === "pan" && !d.moved) stateRef.current.onSelect(null);
      dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, moved: false };
    };

    const onPointerLeave = () => { pointerWorldRef.current.active = false; setHoveredId(null); };
    const onDoubleClick = (e: globalThis.MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && stateRef.current.onDoubleSelect) { alphaRef.current = 0.42; stateRef.current.onDoubleSelect(hit.id); }
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

    let raf = 0, time = 0;
    const stepPhysicsAndDraw = () => {
      raf = window.requestAnimationFrame(stepPhysicsAndDraw);
      time += 0.016;
      const st = stateRef.current;
      const list: SimNode[] = [];
      for (const n of simNodesRef.current.values()) if (st.visibleIds.has(n.id)) list.push(n);

      const alpha = alphaRef.current;
      alphaRef.current = Math.max(0.004, alpha * 0.972);

      if (!reducedMotion) {
        const kGravity = 0.0065 * alpha, kRepulse = 4400 * alpha, ptr = pointerWorldRef.current;
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a.pinned) {
            a.vx -= a.x * kGravity; a.vy -= a.y * kGravity;
            if (ptr.active && !st.activeId) {
              const pdx = a.x - ptr.x, pdy = a.y - ptr.y, pDist = Math.hypot(pdx, pdy);
              if (pDist > 4 && pDist < 130) {
                const push = ((130 - pDist) / 130) * 0.08;
                a.vx += (pdx / pDist) * push; a.vy += (pdy / pDist) * push;
              }
            }
          }
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
            const minGap = a.baseRadius + b.baseRadius + 16;
            const distSq = Math.max(minGap * minGap * 0.5, dx * dx + dy * dy);
            const force = kRepulse / distSq, dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
            if (!b.pinned) { b.vx += fx; b.vy += fy; }
          }
        }

        const kSpring = 0.018 * alpha;
        for (const e of st.activeEdges) {
          const s = simNodesRef.current.get(e.source), t = simNodesRef.current.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x, dy = t.y - s.y, dist = Math.max(1, Math.hypot(dx, dy));
          const isActiveLink = st.activeId && (e.source === st.activeId || e.target === st.activeId);
          const targetLen = isActiveLink ? 105 : 145 + (s.baseRadius + t.baseRadius) * 1.4;
          const strength = isActiveLink ? Math.max(kSpring, 0.008) : kSpring;
          const delta = (dist - targetLen) * strength;
          const fx = (dx / dist) * delta, fy = (dy / dist) * delta;
          if (!s.pinned) { s.vx += fx; s.vy += fy; }
          if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
        }

        for (const n of list) {
          const isHovered = n.id === st.hoveredId;
          const isSelected = n.id === st.selectedId || st.comparingIds.includes(n.id);
          const scale = isHovered ? 1.42 : isSelected ? 1.32 : st.neighborSet.has(n.id) ? 1.16 : st.activeId ? 0.86 : 1.0;
          n.currentRadius += (n.baseRadius * scale - n.currentRadius) * 0.16;
          if (n.pinned) continue;
          n.vx *= 0.76; n.vy *= 0.76;
          n.x += Math.max(-3.2, Math.min(3.2, n.vx));
          n.y += Math.max(-3.2, Math.min(3.2, n.vy));
        }
      }

      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      ctx.translate(viewRef.current.panX, viewRef.current.panY);
      ctx.scale(viewRef.current.zoom, viewRef.current.zoom);

      const hasFocus = st.neighborSet.size > 0 || st.highlightIds.size > 0;
      const isLight = document.documentElement.getAttribute("data-theme") === "carbon-light";

      for (const e of st.activeEdges) {
        const s = simNodesRef.current.get(e.source), t = simNodesRef.current.get(e.target);
        if (!s || !t) continue;
        const isNeighborEdge = Boolean(st.activeId && (e.source === st.activeId || e.target === st.activeId));
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        if (isNeighborEdge) {
          const grad = ctx.createLinearGradient(s.x, s.y, t.x, t.y);
          grad.addColorStop(0, GRAPH_CLUSTER_COLORS[s.cluster][isLight ? "lightColor" : "color"]);
          grad.addColorStop(1, GRAPH_CLUSTER_COLORS[t.cluster][isLight ? "lightColor" : "color"]);
          ctx.strokeStyle = grad; ctx.lineWidth = 2.1; ctx.globalAlpha = 0.92; ctx.stroke();

          const pulseT = (time * 0.55 + (s.id.charCodeAt(0) % 7) * 0.14) % 1;
          ctx.beginPath();
          ctx.arc(s.x + (t.x - s.x) * pulseT, s.y + (t.y - s.y) * pulseT, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? "#0043CE" : "#FFFFFF"; ctx.fill();
        } else {
          ctx.strokeStyle = isLight ? "rgba(15, 98, 254, 0.22)" : "rgba(143, 227, 255, 0.16)";
          ctx.lineWidth = 0.9; ctx.globalAlpha = hasFocus ? 0.1 : 0.55; ctx.stroke();
        }
      }

      for (const n of list) {
        const inFocus = !hasFocus || st.neighborSet.has(n.id) || st.highlightIds.has(n.id);
        const isPrimary = n.id === st.hoveredId || n.id === st.selectedId || st.comparingIds.includes(n.id);
        const color = GRAPH_CLUSTER_COLORS[n.cluster][isLight ? "lightColor" : "color"];
        const r = n.currentRadius;
        ctx.globalAlpha = inFocus ? 1.0 : 0.18;

        if (inFocus && (r >= 9 || isPrimary || st.neighborSet.has(n.id))) {
          const glowR = r * (isPrimary ? 2.8 : 2.1);
          const halo = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, glowR);
          halo.addColorStop(0, hexToRgba(color, isPrimary ? 0.45 : 0.24));
          halo.addColorStop(1, hexToRgba(color, 0));
          ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = halo; ctx.fill();
        }

        const orbGrad = ctx.createRadialGradient(n.x - r * 0.32, n.y - r * 0.32, r * 0.08, n.x, n.y, r);
        orbGrad.addColorStop(0, isLight ? "#FFFFFF" : "#F8FAFC");
        orbGrad.addColorStop(0.32, color);
        orbGrad.addColorStop(1, hexToRgba(color, isLight ? 0.85 : 0.62));
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = orbGrad; ctx.fill();
        ctx.lineWidth = isPrimary ? 2.2 : 1.1;
        ctx.strokeStyle = isPrimary ? (isLight ? "#0F172A" : "#FFFFFF") : hexToRgba(color, 0.9);
        ctx.stroke();

        if (r >= 11 || isPrimary || n.cluster === "BOUNDARY_GAP") {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3.8, 0, Math.PI * 2);
          ctx.lineWidth = isPrimary ? 1.5 : 0.9;
          ctx.strokeStyle = hexToRgba(color, isPrimary ? 0.85 : 0.42); ctx.stroke();
        }

        if (r >= 8.5 || isPrimary || (hasFocus && inFocus)) {
          ctx.font = `${isPrimary || r >= 13 ? 700 : 500} ${isPrimary ? 11.5 : 10.2}px 'Plus Jakarta Sans', sans-serif`;
          ctx.textAlign = "center"; ctx.fillStyle = isLight ? "#0F172A" : "#F8FAFC";
          ctx.fillText(n.label.slice(0, 28), n.x, n.y + r + 14);
        }
      }
      ctx.restore();
    };
    stepPhysicsAndDraw();

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

