import type { MouseEvent } from "react";
import { modules } from "../lib/modules";
import type { View } from "../lib/route";
import { viewUrl } from "../lib/route";

// TODO: replace each placeholder with its module as it is built.
export function PlaceholderPage({ view, onLink }: { view: View; onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const module = modules.find((m) => m.view === view);
  if (!module) return null;
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">Module</p>
        <h1>{module.label}</h1>
      </header>
      <section className="panel placeholder" aria-labelledby="placeholder-title">
        <h2 id="placeholder-title">Not built yet</h2>
        {module.planned && <p><strong>Planned:</strong> {module.planned}</p>}
        {module.note && <p>{module.note}</p>}
        <p>
          Until then, the <a href={viewUrl("overview")} onClick={onLink}>Overview</a> and the{" "}
          <a href={viewUrl("explorer")} onClick={onLink}>Experiment library</a> work with the full PSI data.
        </p>
      </section>
    </div>
  );
}
