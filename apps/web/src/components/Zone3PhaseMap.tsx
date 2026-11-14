import { useState } from "react";
import type { PointerEvent } from "react";
import { SOLID_MAX_AMBIENT_O2 } from "../lib/physics";

export interface Zone3PhaseMapProps {
  o2: number;
  gravity: number;
  onSelectO2?: (o2: number) => void;
  onSelectGravity?: (g: number) => void;
}

export function Zone3PhaseMap({ o2, gravity, onSelectO2, onSelectGravity }: Zone3PhaseMapProps) {
  const [hoverPos, setHoverPos] = useState<{ o2: number; g: number } | null>(null);

  const W = 680;
  const H = 250;
  const PAD_L = 58;
  const PAD_R = 24;
  const PAD_T = 24;
  const PAD_B = 38;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xForO2 = (pct: number) => PAD_L + (Math.max(0, Math.min(100, pct)) / 100) * plotW;
  const yForG = (g: number) => PAD_T + (1 - Math.max(0, Math.min(1, g))) * plotH;

  const handlePointer = (e: PointerEvent<SVGSVGElement>, commit: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
    const svgY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * H;
    const nextO2 = Math.round(Math.max(0, Math.min(100, ((svgX - PAD_L) / plotW) * 100)));
    const nextG = Number(Math.max(0, Math.min(1, 1 - (svgY - PAD_T) / plotH)).toFixed(2));
    setHoverPos({ o2: nextO2, g: nextG });
    if (commit) {
      onSelectO2?.(nextO2);
      onSelectGravity?.(nextG);
    }
  };

  const activeO2 = hoverPos?.o2 ?? o2;
  const activeG = hoverPos?.g ?? gravity;
  const solidMaxX = xForO2(SOLID_MAX_AMBIENT_O2);
  const solidMinX = xForO2(13.6);
  const cursorX = xForO2(activeO2);
  const cursorY = yForG(activeG);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="eyebrow" style={{ margin: 0 }}>
          Zone 3 Telemetry Phase Map · Solid O₂ Max {SOLID_MAX_AMBIENT_O2}% (PSI-25) vs Exploration Gap
        </span>
        <span className="mono-tabular" style={{ fontSize: 12, color: "var(--ice)" }}>
          Cursor: {activeO2}% O₂ · {activeG.toFixed(2)}g{" "}
          {activeO2 > SOLID_MAX_AMBIENT_O2 ? "(SOLID DATA GAP)" : activeO2 >= 13.6 ? "(PSI SOLID COVERED)" : "(QUENCH ZONE)"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", borderRadius: 10, background: "var(--void)", border: "1px solid var(--line)" }}
        role="img"
        aria-label="Zone 3 Oxygen vs Gravity Phase Map showing max 22.2% solid O2 coverage and data gap"
        onPointerMove={(e) => handlePointer(e, e.buttons === 1)}
        onPointerDown={(e) => handlePointer(e, true)}
        onPointerLeave={() => setHoverPos(null)}
      >
        <defs>
          <pattern id="z3-burner-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#FF7A1A" strokeWidth="2.5" strokeOpacity="0.45" />
          </pattern>
          <linearGradient id="z3-gap-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(244, 63, 94, 0.22)" />
            <stop offset="100%" stopColor="rgba(244, 63, 94, 0.06)" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 20, 40, 60, 80, 100].map((tick) => {
          const x = xForO2(tick);
          return (
            <g key={tick}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke="var(--line)" strokeDasharray="3 3" />
              <text x={x} y={H - 12} fill="var(--muted)" fontSize="11" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                {tick}%
              </text>
            </g>
          );
        })}

        {[0, 0.17, 0.38, 1.0].map((gTick) => {
          const y = yForG(gTick);
          return (
            <g key={gTick}>
              <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={PAD_L - 8} y={y + 4} fill="var(--muted)" fontSize="10.5" textAnchor="end" fontFamily="JetBrains Mono, monospace">
                {gTick.toFixed(2)}g
              </text>
            </g>
          );
        })}

        {/* Solid O2 Verified Coverage Band (13.6% - 22.2% at 0g) */}
        <rect
          x={solidMinX}
          y={yForG(0.12)}
          width={solidMaxX - solidMinX}
          height={yForG(0) - yForG(0.12)}
          fill="var(--o2-soft)"
          stroke="var(--blue)"
          strokeWidth="1.5"
          rx="3"
        />

        {/* Burner-fed Gaseous O2 Coverage (12% - 85%, hatched) */}
        <rect
          x={xForO2(12)}
          y={yForG(0.24)}
          width={xForO2(85) - xForO2(12)}
          height={yForG(0.12) - yForG(0.24)}
          fill="url(#z3-burner-hatch)"
          stroke="var(--ember)"
          strokeOpacity="0.6"
          rx="3"
        />

        {/* Uncharted Solid O2 & Partial Gravity DATA GAP Region (> 22.2% O2) */}
        <rect
          x={solidMaxX}
          y={PAD_T}
          width={xForO2(100) - solidMaxX}
          height={plotH}
          fill="url(#z3-gap-grad)"
          stroke="var(--alert)"
          strokeDasharray="5 4"
          strokeWidth="1.2"
        />

        {/* Hard Boundary Line at 22.2% Solid O2 Max */}
        <line x1={solidMaxX} y1={PAD_T} x2={solidMaxX} y2={PAD_T + plotH} stroke="var(--ice)" strokeWidth="2" />
        <text x={solidMaxX - 6} y={PAD_T + 15} fill="var(--o2-text)" fontSize="10.5" textAnchor="end" fontFamily="JetBrains Mono, monospace">
          Max Solid O₂: 22.2% (PSI-25)
        </text>

        {/* Exploration 34% O2 Reference Line */}
        <line x1={xForO2(34)} y1={PAD_T} x2={xForO2(34)} y2={PAD_T + plotH} stroke="var(--alert)" strokeWidth="1.8" strokeDasharray="4 3" />
        <text x={xForO2(34) + 6} y={PAD_T + 30} fill="var(--alert)" fontSize="10.5" fontFamily="JetBrains Mono, monospace">
          34% Exploration Habitat (SOLID GAP)
        </text>

        <text x={xForO2(64)} y={PAD_T + plotH * 0.48} fill="var(--alert)" fontSize="12" fontWeight="600" textAnchor="middle" fontFamily="Chakra Petch, sans-serif">
          EVIDENCE GAP: NO SOLID BURNS &gt; 22.2% O₂ OR AT 0.17g / 0.38g
        </text>

        {/* Dynamic Telemetry Crosshair Cursor */}
        <line x1={cursorX} y1={PAD_T} x2={cursorX} y2={PAD_T + plotH} stroke="var(--blue)" strokeOpacity="0.55" />
        <line x1={PAD_L} y1={cursorY} x2={PAD_L + plotW} y2={cursorY} stroke="var(--blue)" strokeOpacity="0.55" />
        <circle cx={cursorX} cy={cursorY} r="6.5" fill="var(--void)" stroke="var(--blue)" strokeWidth="2.5" />
      </svg>
    </div>
  );
}

