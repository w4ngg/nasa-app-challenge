import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { modules } from "../lib/modules";
import { viewUrl } from "../lib/route";
import type { View } from "../lib/route";

/** Left rail on wide screens; a top bar with a menu button on narrow ones. */
export function SideNav({ current, onLink }: {
  current: View | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
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
    <aside className="side-nav">
      <div className="side-top">
        <a className="brand" href={viewUrl("overview")} onClick={follow} aria-label="Flame Atlas, overview">
          <span className="brand-mark" aria-hidden="true">FA</span>
          <span>Flame Atlas<small>Microgravity combustion evidence</small></span>
        </a>
        <button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen((v) => !v)}>
          {open ? "Close menu" : "Menu"}
        </button>
      </div>
      <nav id="side-menu" className={open ? "side-menu open" : "side-menu"} aria-label="Main">
        <p className="side-group">Modules</p>
        <ul>
          {modules.map((m) => (
            <li key={m.view}>
              <a href={viewUrl(m.view)} onClick={follow} aria-current={current === m.view ? "page" : undefined}
                className={m.built ? undefined : "is-planned"}>
                <span>{m.label}</span>
                {!m.built && <span className="soon">Not built</span>}
              </a>
            </li>
          ))}
        </ul>
        <p className="side-foot">
          Data: <a href="https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation" target="_blank" rel="noreferrer">NASA PSI</a>
        </p>
      </nav>
    </aside>
  );
}
