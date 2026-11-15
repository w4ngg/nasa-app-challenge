import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

export type ResizeAxis = "x" | "y" | "both";
export type SplitMode = "ratio" | "left-px" | "right-px";

const GUTTER_PX = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function readStored<T>(key: string | undefined, validate: (v: unknown) => v is T): T | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string | undefined, value: unknown): void {
  if (!key || typeof window === "undefined") return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

export interface PointerDragOptions {
  cursor: string;
  onMove: (dx: number, dy: number, clientX: number, clientY: number) => void;
  onEnd?: () => void;
}

/**
 * Starts a pointer-captured border drag while suppressing parent canvas gestures and text selection.
 */
export function startPointerDrag(
  event: React.PointerEvent<HTMLElement>,
  { cursor, onMove, onEnd }: PointerDragOptions,
): () => void {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  const prevCursor = document.body.style.cursor;
  const prevSelect = document.body.style.userSelect;

  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  try {
    target.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events in tests may lack an active pointerId.
  }

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    try {
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release errors if target unmounted.
    }
    onEnd?.();
  };

  const handleMove = (moveEvent: PointerEvent) => {
    onMove(moveEvent.clientX - startX, moveEvent.clientY - startY, moveEvent.clientX, moveEvent.clientY);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
  return cleanup;
}

interface StoredSplit {
  size?: number | null;
  height?: number | null;
}

function isStoredSplit(v: unknown): v is StoredSplit {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  const okSize = obj.size == null || (typeof obj.size === "number" && Number.isFinite(obj.size));
  const okHeight = obj.height == null || (typeof obj.height === "number" && Number.isFinite(obj.height));
  return okSize && okHeight;
}

export interface ResizableSplitProps {
  left: ReactNode;
  right: ReactNode;
  className?: string;
  ariaLabel?: string;
  mode?: SplitMode;
  defaultSize?: number;
  leftMin?: number;
  rightMin?: number;
  resizableHeight?: boolean;
  minHeight?: number;
  maxHeight?: number;
  storageKey?: string;
}

/**
 * Side-by-side responsive split container with a draggable center border and optional bottom height handle.
 */
export function ResizableSplit({
  left,
  right,
  className = "",
  ariaLabel = "Resize panels",
  mode = "ratio",
  defaultSize = mode === "ratio" ? 0.5 : 300,
  leftMin = 200,
  rightMin = 200,
  resizableHeight = false,
  minHeight = 260,
  maxHeight = 1600,
  storageKey,
}: ResizableSplitProps) {
  const initial = readStored(storageKey, isStoredSplit);
  const [size, setSize] = useState<number | null>(() => initial?.size ?? null);
  const [height, setHeight] = useState<number | null>(() => initial?.height ?? null);
  const [dragging, setDragging] = useState<"x" | "y" | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    if (size == null && height == null) writeStored(storageKey, null);
    else writeStored(storageKey, { size, height });
  }, [storageKey, size, height]);

  const handleColPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (!root || !leftEl || !rightEl) return;

    const usable = Math.max(1, root.getBoundingClientRect().width - GUTTER_PX);
    const startLeft = leftEl.getBoundingClientRect().width;
    const startRight = rightEl.getBoundingClientRect().width;

    setDragging("x");
    cleanupRef.current = startPointerDrag(event, {
      cursor: "col-resize",
      onMove: (dx) => {
        if (mode === "left-px") {
          const maxLeft = Math.max(leftMin, usable - rightMin);
          setSize(Math.round(clamp(startLeft + dx, leftMin, maxLeft)));
        } else if (mode === "right-px") {
          const maxRight = Math.max(rightMin, usable - leftMin);
          setSize(Math.round(clamp(startRight - dx, rightMin, maxRight)));
        } else {
          const maxLeft = Math.max(leftMin, usable - rightMin);
          const nextLeft = clamp(startLeft + dx, leftMin, maxLeft);
          setSize(Number((nextLeft / usable).toFixed(4)));
        }
      },
      onEnd: () => setDragging(null),
    });
  };

  const handleColKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      setSize(null);
      return;
    }
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const usable = Math.max(1, (rootRef.current?.getBoundingClientRect().width ?? 1000) - GUTTER_PX);
    if (mode === "ratio") {
      const current = size ?? defaultSize;
      const minR = clamp(leftMin / usable, 0.12, 0.85);
      const maxR = clamp(1 - rightMin / usable, minR, 0.88);
      setSize(Number(clamp(current + delta * 0.03, minR, maxR).toFixed(4)));
    } else if (mode === "left-px") {
      const current = size ?? defaultSize;
      setSize(Math.round(clamp(current + delta * 24, leftMin, Math.max(leftMin, usable - rightMin))));
    } else {
      const current = size ?? defaultSize;
      setSize(Math.round(clamp(current - delta * 24, rightMin, Math.max(rightMin, usable - leftMin))));
    }
  };

  const handleHeightPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const startH = root.getBoundingClientRect().height;
    setDragging("y");
    cleanupRef.current = startPointerDrag(event, {
      cursor: "ns-resize",
      onMove: (_dx, dy) => {
        setHeight(Math.round(clamp(startH + dy, minHeight, maxHeight)));
      },
      onEnd: () => setDragging(null),
    });
  };

  const handleHeightKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      setHeight(null);
      return;
    }
    const delta = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
    if (!delta) return;
    event.preventDefault();
    const current = height ?? Math.round(rootRef.current?.getBoundingClientRect().height ?? minHeight);
    setHeight(Math.round(clamp(current + delta, minHeight, maxHeight)));
  };

  let splitCols: string | undefined;
  if (size != null) {
    if (mode === "left-px") {
      splitCols = `clamp(${leftMin}px, ${size}px, calc(100% - ${rightMin + GUTTER_PX}px)) ${GUTTER_PX}px minmax(0, 1fr)`;
    } else if (mode === "right-px") {
      splitCols = `minmax(0, 1fr) ${GUTTER_PX}px clamp(${rightMin}px, ${size}px, calc(100% - ${leftMin + GUTTER_PX}px))`;
    } else {
      splitCols = `minmax(0, calc(${size} * (100% - ${GUTTER_PX}px))) ${GUTTER_PX}px minmax(0, 1fr)`;
    }
  }

  const style: Record<string, string> = {};
  if (splitCols) style["--split-cols"] = splitCols;
  if (height != null) style["--split-h"] = `${height}px`;

  const classes = [
    "resizable-split",
    className,
    height != null ? "has-custom-height" : "",
    dragging ? `is-dragging-${dragging}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={classes} style={style as CSSProperties}>
      <div ref={leftRef} className="split-pane split-pane-a">{left}</div>
      <div
        className="split-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        tabIndex={0}
        title="Drag border to resize columns · Double-click to reset"
        onPointerDown={handleColPointerDown}
        onKeyDown={handleColKeyDown}
        onDoubleClick={() => setSize(null)}
      >
        <span className="split-gutter-grip" aria-hidden="true" />
      </div>
      <div ref={rightRef} className="split-pane split-pane-b">{right}</div>
      {resizableHeight && (
        <div
          className="resize-edge resize-edge-b split-bottom-edge"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag bottom border to resize height"
          tabIndex={0}
          title="Drag bottom border to resize height · Double-click to reset"
          onPointerDown={handleHeightPointerDown}
          onKeyDown={handleHeightKeyDown}
          onDoubleClick={() => setHeight(null)}
        >
          <span className="resize-edge-pill" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

interface StoredBox {
  width?: number | null;
  height?: number | null;
}

function isStoredBox(v: unknown): v is StoredBox {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  const okW = obj.width == null || (typeof obj.width === "number" && Number.isFinite(obj.width));
  const okH = obj.height == null || (typeof obj.height === "number" && Number.isFinite(obj.height));
  return okW && okH;
}

export interface ResizableBoxProps {
  children: ReactNode;
  className?: string;
  axes?: ResizeAxis;
  minWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  storageKey?: string;
  fillChild?: boolean;
}

/**
 * Container whose right, bottom, and corner borders can be dragged to scale width and height.
 */
export function ResizableBox({
  children,
  className = "",
  axes = "both",
  minWidth = 240,
  minHeight = 160,
  maxHeight = 1600,
  storageKey,
  fillChild = true,
}: ResizableBoxProps) {
  const initial = readStored(storageKey, isStoredBox);
  const [width, setWidth] = useState<number | null>(() => initial?.width ?? null);
  const [height, setHeight] = useState<number | null>(() => initial?.height ?? null);
  const [dragging, setDragging] = useState<ResizeAxis | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    if (width == null && height == null) writeStored(storageKey, null);
    else writeStored(storageKey, { width, height });
  }, [storageKey, width, height]);

  const canX = axes === "x" || axes === "both";
  const canY = axes === "y" || axes === "both";

  const beginDrag = (mode: ResizeAxis) => (event: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const parentWidth = box.parentElement?.getBoundingClientRect().width ?? rect.width;
    const maxWidth = Math.max(minWidth, Math.round(parentWidth));
    const cursor = mode === "both" ? "nwse-resize" : mode === "x" ? "ew-resize" : "ns-resize";

    setDragging(mode);
    cleanupRef.current = startPointerDrag(event, {
      cursor,
      onMove: (dx, dy) => {
        if (mode === "x" || mode === "both") {
          setWidth(Math.round(clamp(rect.width + dx, minWidth, maxWidth)));
        }
        if (mode === "y" || mode === "both") {
          setHeight(Math.round(clamp(rect.height + dy, minHeight, maxHeight)));
        }
      },
      onEnd: () => setDragging(null),
    });
  };

  const handleEdgeKey = (axis: "x" | "y") => (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      if (axis === "x") setWidth(null);
      else setHeight(null);
      return;
    }
    const delta =
      axis === "x"
        ? (event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0)
        : (event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0);
    if (!delta) return;
    event.preventDefault();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    if (axis === "x") {
      const parentWidth = box.parentElement?.getBoundingClientRect().width ?? rect.width;
      setWidth(Math.round(clamp((width ?? rect.width) + delta, minWidth, Math.max(minWidth, parentWidth))));
    } else {
      setHeight(Math.round(clamp((height ?? rect.height) + delta, minHeight, maxHeight)));
    }
  };

  const style: Record<string, string> = {};
  if (width != null) style["--box-w"] = `${width}px`;
  if (height != null) style["--box-h"] = `${height}px`;

  const classes = [
    "resizable-box",
    className,
    fillChild ? "is-fill-child" : "",
    width != null ? "has-custom-width" : "",
    height != null ? "has-custom-height" : "",
    dragging ? `is-dragging-${dragging}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={boxRef} className={classes} style={style as CSSProperties}>
      {children}
      {canX && (
        <div
          className="resize-edge resize-edge-r"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag right border to resize width"
          tabIndex={0}
          title="Drag right border to resize width · Double-click to reset"
          onPointerDown={beginDrag("x")}
          onKeyDown={handleEdgeKey("x")}
          onDoubleClick={() => setWidth(null)}
        />
      )}
      {canY && (
        <div
          className="resize-edge resize-edge-b"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag bottom border to resize height"
          tabIndex={0}
          title="Drag bottom border to resize height · Double-click to reset"
          onPointerDown={beginDrag("y")}
          onKeyDown={handleEdgeKey("y")}
          onDoubleClick={() => setHeight(null)}
        >
          <span className="resize-edge-pill" aria-hidden="true" />
        </div>
      )}
      {canX && canY && (
        <div
          className="resize-corner"
          title="Drag corner to scale width and height · Double-click to reset"
          onPointerDown={beginDrag("both")}
          onDoubleClick={() => {
            setWidth(null);
            setHeight(null);
          }}
        />
      )}
    </div>
  );
}
