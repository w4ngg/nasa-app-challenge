import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { modules } from "../lib/modules";
import { viewUrl } from "../lib/route";
import type { View } from "../lib/route";

const MODULE_SHORT: Record<View, string> = {
  overview: "OV",
  map: "KM",
  chamber: "3D",
  explorer: "EL",
  compare: "MC",
  assistant: "AI",
  habitat: "HC",
  lab: "DA",
};

/** Left rail on wide screens (with collapsible compact rail mode); top bar with menu button on narrow ones. */
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
          <span className="brand-mark" aria-hidden="true">FA</span>
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
            {collapsed ? "»" : "«"}
          </button>
        )}
        <button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen((v) => !v)}>
          {open ? "Close menu" : "Menu"}
        </button>
      </div>
      <nav id="side-menu" className={open ? "side-menu open" : "side-menu"} aria-label="Main">
        <p className="side-group">{collapsed ? "MOD" : "Modules"}</p>
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
                  <span className="nav-short" aria-hidden="true">{MODULE_SHORT[m.view]}</span>
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
