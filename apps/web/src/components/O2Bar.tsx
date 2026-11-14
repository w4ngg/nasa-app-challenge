import { basisLabels, percentRange } from "../lib/labels";
import type { O2Observation } from "../types";

/**
 * Oxygen ranges drawn on a fixed 0-100 % track, so ranges compare across
 * investigations. The 21 % tick marks Earth air; burner-fed oxygen is hatched.
 */
export function O2Bar({ observations, compact = false }: { observations: O2Observation[]; compact?: boolean }) {
  if (observations.length === 0) {
    return <p className="o2-missing">O₂: not recorded in the experiment tables</p>;
  }
  const min = Math.min(...observations.map((o) => o.min_percent));
  const max = Math.max(...observations.map((o) => o.max_percent));
  const description = observations
    .map((o) => `${percentRange(o.min_percent, o.max_percent)} (${basisLabels[o.basis]})`)
    .join("; ");
  return (
    <div className={compact ? "o2 o2-compact" : "o2"}>
      <span className="o2-label">O₂ {percentRange(min, max)}</span>
      <span className="o2-track" role="img" aria-label={`Oxygen range: ${description}. Tick marks 21%, Earth air.`}>
        <span className="o2-air" style={{ left: "21%" }} aria-hidden="true" />
        {observations.map((o) => (
          <span
            key={`${o.source_file}-${o.basis}`}
            className={`o2-range o2-${o.basis}`}
            style={{ left: `${o.min_percent}%`, width: `max(4px, ${o.max_percent - o.min_percent}%)` }}
          />
        ))}
      </span>
    </div>
  );
}
