// Interactive Geometry, Cubic Bezier Morphing (26 control coordinates),
// Hex Color Mixing & Microgravity Combustion Regime Physics.

export const SOLID_MAX_AMBIENT_O2 = 22.2; // PSI-25 (BASS-II) maximum recorded chamber O2 for solids

/**
 * 26 coordinates for a 4-segment closed Cubic Bezier curve:
 * [x0, y0,  c1x1, c1y1, c1x2, c1y2, x1, y1,  c2x1, c2y1, c2x2, c2y2, x2, y2,
 *  c3x1, c3y1, c3x2, c3y2, x3, y3,  c4x1, c4y1, c4x2, c4y2, x4, y4]
 * Centered in a 200x200 viewBox.
 */
export const PATH_SPHERE_0G: readonly number[] = [
  100, 36, // Top apex (0g spherical diffusion dome)
  136, 36, 164, 64, 164, 100, // Right quadrant arc
  164, 136, 136, 164, 100, 164, // Bottom right arc
  64, 164, 36, 136, 36, 100, // Bottom left arc
  36, 64, 64, 36, 100, 36, // Top left arc back to apex
] as const;

export const PATH_TEARDROP_1G: readonly number[] = [
  100, 14, // Elongated buoyant plume tip (1g)
  122, 46, 156, 82, 152, 122, // Right buoyant shear layer
  148, 154, 126, 172, 100, 172, // Base right envelope
  74, 172, 52, 154, 48, 122, // Base left envelope
  44, 82, 78, 46, 100, 14, // Left buoyant shear layer back to tip
] as const;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Interpolates all 26 control-point coordinates between PATH_SPHERE_0G (0g)
 * and PATH_TEARDROP_1G (1g) to produce a smooth SVG <path d="..." /> string.
 */
export function interpolateEmberPath(gravity: number): string {
  const g = clamp01(gravity);
  const pts: number[] = new Array(26);
  for (let i = 0; i < 26; i++) {
    pts[i] = Number(lerp(PATH_SPHERE_0G[i], PATH_TEARDROP_1G[i], g).toFixed(2));
  }
  return [
    `M ${pts[0]} ${pts[1]}`,
    `C ${pts[2]} ${pts[3]}, ${pts[4]} ${pts[5]}, ${pts[6]} ${pts[7]}`,
    `C ${pts[8]} ${pts[9]}, ${pts[10]} ${pts[11]}, ${pts[12]} ${pts[13]}`,
    `C ${pts[14]} ${pts[15]}, ${pts[16]} ${pts[17]}, ${pts[18]} ${pts[19]}`,
    `C ${pts[20]} ${pts[21]}, ${pts[22]} ${pts[23]}, ${pts[24]} ${pts[25]}`,
    "Z",
  ].join(" ");
}

function parseHexChannel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16);
}

function toHexByte(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/**
 * Linearly mixes two 6-digit RGB hex strings (#RRGGBB) by factor t in [0, 1].
 */
export function mixHex(hexA: string, hexB: string, t: number): string {
  const factor = clamp01(t);
  const a = hexA.replace(/^#/, "");
  const b = hexB.replace(/^#/, "");
  const r = lerp(parseHexChannel(a, 0), parseHexChannel(b, 0), factor);
  const g = lerp(parseHexChannel(a, 2), parseHexChannel(b, 2), factor);
  const bl = lerp(parseHexChannel(a, 4), parseHexChannel(b, 4), factor);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`;
}

export interface EmberGradientStops {
  inner: string;
  mid: string;
  outer: string;
}

/**
 * Interpolates 3 gradient stops from 0g cool spherical diffusion flame
 * (#8FE3FF / #6FC6FF / #4FA8FF) to 1g buoyant hydrocarbon flame
 * (#FFE08A / #FFB347 / #FF7A1A).
 */
export function getEmberGradientStops(gravity: number): EmberGradientStops {
  const g = clamp01(gravity);
  return {
    inner: mixHex("#8FE3FF", "#FFE08A", g),
    mid: mixHex("#6FC6FF", "#FFB347", g),
    outer: mixHex("#4FA8FF", "#FF7A1A", g),
  };
}

export interface FlameRegimeReadout {
  regimeLabel: string;
  transportMode: string;
  solidEvidenceState: "VERIFIED_PSI_CSV" | "QUENCH_LIMIT" | "DATA_GAP";
  mood: "calm" | "energetic" | "alert" | "hypoxic";
}

export function describeFlameRegime(gravity: number, o2Percent: number): FlameRegimeReadout {
  const g = clamp01(gravity);
  const o2 = Math.max(0, Math.min(100, o2Percent));
  const transportMode =
    g < 0.05
      ? "Pure molecular diffusion (0g spherical symmetry)"
      : g < 0.45
        ? `Partial-gravity mixed convection (${g.toFixed(2)}g)`
        : `Buoyancy-dominated plume (${g.toFixed(2)}g teardrop)`;

  if (o2 < 13.6) {
    return {
      regimeLabel: "Sub-Limit / Quenching Zone",
      transportMode,
      solidEvidenceState: "QUENCH_LIMIT",
      mood: "hypoxic",
    };
  }
  if (o2 <= SOLID_MAX_AMBIENT_O2 && g < 0.05) {
    return {
      regimeLabel: "Tested ISS Solid & Gas Regime (13.6%–22.2% O₂)",
      transportMode,
      solidEvidenceState: "VERIFIED_PSI_CSV",
      mood: "calm",
    };
  }
  if (o2 > SOLID_MAX_AMBIENT_O2) {
    return {
      regimeLabel: `Elevated O₂ Regime (> ${SOLID_MAX_AMBIENT_O2}% Solid Gap)`,
      transportMode,
      solidEvidenceState: "DATA_GAP",
      mood: o2 >= 34 ? "alert" : "energetic",
    };
  }
  return {
    regimeLabel: "Partial-Gravity Uncharted Regime",
    transportMode,
    solidEvidenceState: "DATA_GAP",
    mood: "alert",
  };
}

