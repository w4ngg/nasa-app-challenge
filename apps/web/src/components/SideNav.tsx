import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { modules } from "../lib/modules";
import { viewUrl } from "../lib/route";
import type { View } from "../lib/route";

/** Custom aerospace vector emblem for Flame Atlas (Orbital Ring + Microgravity Flame Core). */
function FlameAtlasLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fa-flame-outer" x1="14" y1="4" x2="14" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF7A1A" />
          <stop offset="55%" stopColor="#4FA8FF" />
          <stop offset="100%" stopColor="#8FE3FF" />
        </linearGradient>
        <linearGradient id="fa-orbit" x1="2" y1="14" x2="26" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8FE3FF" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#A78BFA" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#FF7A1A" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {/* Faceted octagonal cosmic frame */}
      <polygon
        points="14,1.8 22.6,5.4 26.2,14 22.6,22.6 14,26.2 5.4,22.6 1.8,14 5.4,5.4"
        stroke="rgba(143, 227, 255, 0.32)"
        strokeWidth="1"
        fill="rgba(5, 7, 14, 0.55)"
      />
      {/* Tilted orbital ring */}
      <ellipse
        cx="14"
        cy="15"
        rx="11.2"
        ry="4.4"
        transform="rotate(-24 14 15)"
        stroke="url(#fa-orbit)"
        strokeWidth="1.35"
      />
      {/* Outer microgravity teardrop/crystal flame */}
      <path
        d="M14 4.5C14 4.5 19.6 10.6 19.6 15.4C19.6 18.7 17.1 21.4 14 21.4C10.9 21.4 8.4 18.7 8.4 15.4C8.4 10.6 14 4.5 14 4.5Z"
        fill="url(#fa-flame-outer)"
        stroke="#8FE3FF"
        strokeWidth="0.9"
      />
      {/* Inner 0g spherical cool-flame core */}
      <circle cx="14" cy="16" r="3.1" fill="#F8FAFC" />
      {/* Orbital satellite spark */}
      <circle cx="23.6" cy="10.8" r="1.5" fill="#FF7A1A" />
    </svg>
  );
}

/** Custom SVG icon per navigation module (replaces OV, KM, 3D, EL, MC, AI, HC, DA text). */
function ModuleIcon({ view }: { view: View }) {
  switch (view) {
    case "overview":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="6.2" height="6.2" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          <rect x="11.3" y="2.5" width="6.2" height="6.2" rx="1.4" stroke="#8FE3FF" strokeWidth="1.5" />
          <rect x="2.5" y="11.3" width="6.2" height="6.2" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="14.4" cy="14.4" r="3.1" stroke="#FF7A1A" strokeWidth="1.5" />
        </svg>
      );
    case "map":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <line x1="10" y1="10" x2="4.2" y2="4.8" stroke="currentColor" strokeWidth="1.3" />
          <line x1="10" y1="10" x2="16" y2="5.2" stroke="currentColor" strokeWidth="1.3" />
          <line x1="10" y1="10" x2="5" y2="15.8" stroke="currentColor" strokeWidth="1.3" />
          <line x1="10" y1="10" x2="15.8" y2="15.2" stroke="currentColor" strokeWidth="1.3" />
          <polygon points="10,6.2 13.8,10 10,13.8 6.2,10" fill="#4FA8FF" stroke="#8FE3FF" strokeWidth="1.3" />
          <circle cx="4.2" cy="4.8" r="1.8" fill="#A78BFA" />
          <circle cx="16" cy="5.2" r="1.8" fill="#FF7A1A" />
          <circle cx="5" cy="15.8" r="1.8" fill="#8FE3FF" />
          <circle cx="15.8" cy="15.2" r="1.8" fill="#F43F5E" />
        </svg>
      );
    case "chamber":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <polygon points="10,1.8 17.4,6 17.4,14 10,18.2 2.6,14 2.6,6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 5.5C10 5.5 13.6 9.3 13.6 12C13.6 14 12 15.5 10 15.5C8 15.5 6.4 14 6.4 12C6.4 9.3 10 5.5 10 5.5Z" fill="#FF7A1A" stroke="#8FE3FF" strokeWidth="1.1" />
          <circle cx="10" cy="12.3" r="1.5" fill="#FFFFFF" />
        </svg>
      );
    case "explorer":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 6.2L10 2.8L17 6.2L10 9.6L3 6.2Z" stroke="#8FE3FF" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M3 10L10 13.4L17 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 13.8L10 17.2L17 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "compare":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="3.5" width="6" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
          <rect x="11.5" y="3.5" width="6" height="13" rx="1.4" stroke="#8FE3FF" strokeWidth="1.4" />
          <path d="M7.5 10H12.5" stroke="#FF7A1A" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "assistant":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2L12.1 7.9L18 10L12.1 12.1L10 18L7.9 12.1L2 10L7.9 7.9L10 2Z" fill="rgba(167, 139, 250, 0.28)" stroke="#A78BFA" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="10" cy="10" r="1.6" fill="#8FE3FF" />
        </svg>
      );
    case "habitat":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2.3L16.5 5.2V10.4C16.5 14.3 13.7 16.9 10 18C6.3 16.9 3.5 14.3 3.5 10.4V5.2L10 2.3Z" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.2 10.3L9.2 12.3L13.2 8.3" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "lab":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 3.2V16.8H17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M5.5 13.5L9.2 9.4L12.4 11.4L16.2 5.6" stroke="#8FE3FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9.2" cy="9.4" r="1.5" fill="#FF7A1A" />
          <circle cx="16.2" cy="5.6" r="1.6" fill="#10B981" />
        </svg>
      );
  }
}

/** Left rail on wide screens (with collapsible compact icon rail mode); top bar on narrow ones. */
export function SideNav({
  current,
  onLink,
  collapsed = false,
  onToggleCollapse,
}: {
  current: View | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const follow = (event: MouseEvent<HTMLAnchorElement>) => { setOpen(false); onLink(event); };

  return (
    <aside className={collapsed ? "side-nav is-collapsed" : "side-nav"}>
      <div className="side-top">
        <a className="brand" href={viewUrl("overview")} onClick={follow} aria-label="Flame Atlas, overview" title="Flame Atlas — Microgravity combustion evidence">
          <span className="brand-mark" aria-hidden="true">
            <FlameAtlasLogo />
          </span>
          <span className="brand-text">Flame Atlas<small>Microgravity combustion evidence</small></span>
        </a>
        {onToggleCollapse && (
          <button
            type="button"
            className="rail-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="2.5" y="3" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <line x1="7.5" y1="3" x2="7.5" y2="17" stroke="currentColor" strokeWidth="1.3" />
              {collapsed ? (
                <path d="M11 7.5L13.8 10L11 12.5" stroke="#8FE3FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M13.5 7.5L10.7 10L13.5 12.5" stroke="#8FE3FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        )}
        <button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen((v) => !v)}>
          {open ? "Close menu" : "Menu"}
        </button>
      </div>
      <nav id="side-menu" className={open ? "side-menu open" : "side-menu"} aria-label="Main">
        <p className="side-group">{collapsed ? "✦" : "Modules"}</p>
        <ul>
          {modules.map((m) => (
            <li key={m.view}>
              <a
                href={viewUrl(m.view)}
                onClick={follow}
                aria-current={current === m.view ? "page" : undefined}
                className={m.built ? undefined : "is-planned"}
                title={m.built ? m.label : `${m.label} (Not built)`}
              >
                <span className="nav-item-main">
                  <span className="nav-short" aria-hidden="true">
                    <ModuleIcon view={m.view} />
                  </span>
                  <span className="nav-label">{m.label}</span>
                </span>
                {!m.built && <span className="soon">Not built</span>}
              </a>
            </li>
          ))}
        </ul>
        <p className="side-foot">
          <span className="side-foot-label">Data: </span>
          <a href="https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation" target="_blank" rel="noreferrer" title="NASA Physical Sciences Informatics (PSI)">
            {collapsed ? "PSI" : "NASA PSI"}
          </a>
        </p>
      </nav>
    </aside>
  );
}
