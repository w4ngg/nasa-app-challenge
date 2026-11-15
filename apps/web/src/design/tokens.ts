// Deep Space Obsidian & Carbon Light 3D Design System Tokens & Cluster Palette
// Automatically adapts UI colors, 3D galaxy shaders, and semantic clusters across Dark & Light themes.

export type ThemeMode = "obsidian" | "carbon-light";

export interface ObsidianTokenSpec {
  cssVar: `--${string}`;
  name: string;
  hex: string;
  role: string;
}

export const OBSIDIAN_TOKENS: ObsidianTokenSpec[] = [
  { cssVar: "--void", name: "Void", hex: "#05070E", role: "Deep space canvas & primary viewport background" },
  { cssVar: "--panel", name: "Panel", hex: "#0B101D", role: "Obsidian telemetry cards, modals & elevated surfaces" },
  { cssVar: "--ember", name: "Ember", hex: "#FF7A1A", role: "1g buoyant combustion, burner-fed O₂ & thermal highlights" },
  { cssVar: "--blue", name: "Blue", hex: "#4FA8FF", role: "Primary microgravity accent, PSI CSV data & interactive focus" },
  { cssVar: "--ice", name: "Ice", hex: "#8FE3FF", role: "0g spherical diffusion shell, hardware tags & cool flames" },
  { cssVar: "--violet", name: "Violet", hex: "#A78BFA", role: "UV OH* chemiluminescence, metadata & abstract records" },
  { cssVar: "--ok", name: "OK", hex: "#10B981", role: "Verified table evidence, exact condition match & nominal status" },
  { cssVar: "--alert", name: "Alert", hex: "#F43F5E", role: "Evidence boundary gap, unrecorded O₂ & refusal circuit breaker" },
];

export const CARBON_LIGHT_TOKENS: ObsidianTokenSpec[] = [
  { cssVar: "--void", name: "Void (Light)", hex: "#EEF4FF", role: "Celestial daylight backdrop for 3D galaxy" },
  { cssVar: "--panel", name: "Panel (Glass)", hex: "#FFFFFF", role: "Frosted 3D glass telemetry surface" },
  { cssVar: "--ember", name: "Ember", hex: "#D9460F", role: "1g buoyant combustion & burner-fed O₂ accent" },
  { cssVar: "--blue", name: "Blue 60", hex: "#0F62FE", role: "Primary microgravity accent & PSI CSV data" },
  { cssVar: "--ice", name: "Cobalt 70", hex: "#0043CE", role: "0g spherical diffusion shell & interactive links" },
  { cssVar: "--violet", name: "Purple 60", hex: "#6929C4", role: "UV OH* chemiluminescence & metadata records" },
  { cssVar: "--ok", name: "Green 60", hex: "#198038", role: "Verified table evidence & exact condition match" },
  { cssVar: "--alert", name: "Red 60", hex: "#DA1E28", role: "Evidence boundary gap & refusal circuit breaker" },
];

export function getThemeTokens(theme: ThemeMode): ObsidianTokenSpec[] {
  return theme === "carbon-light" ? CARBON_LIGHT_TOKENS : OBSIDIAN_TOKENS;
}

export const GRAPH_CLUSTER_COLORS = {
  PSI_CSV: { label: "PSI CSV", color: "#4FA8FF", lightColor: "#0F62FE", token: "var(--blue)" },
  METADATA_ABS: { label: "Metadata·Abs", color: "#A78BFA", lightColor: "#6929C4", token: "var(--violet)" },
  FUEL: { label: "Fuel", color: "#FF7A1A", lightColor: "#D9460F", token: "var(--ember)" },
  HARDWARE: { label: "Hardware", color: "#8FE3FF", lightColor: "#009D9A", token: "var(--ice)" },
  BOUNDARY_GAP: { label: "Boundary·Gap", color: "#F43F5E", lightColor: "#DA1E28", token: "var(--alert)" },
} as const;

export const FONT_HIERARCHY = {
  display: "'Chakra Petch', system-ui, sans-serif",
  sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
} as const;
