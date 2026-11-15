import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Cam, Key, Label, Mark, TimeCtx, VideoCam, fadeWindow, useT } from "./parts";
import { C, display, easeOut, mono, sans } from "./theme";

// Shot table. `design` is the timeline each scene was animated on (cut on music bars);
// `at` is where it plays in the final cut, retimed so each scene starts with its voiceover
// line. Every `at` boundary sits on a beat of bgm.mp3. 894 frames = 29.8 s.
export const SHOTS = {
  hook: { design: [0, 119], at: [0, 148] },
  brand: { design: [119, 238], at: [148, 296] },
  overview: { design: [238, 355], at: [296, 398] },
  analytics: { design: [355, 471], at: [398, 515] },
  map: { design: [471, 642], at: [515, 628] },
  compare: { design: [642, 756], at: [628, 742] },
  assistant: { design: [756, 813], at: [742, 813] },
  outro: { design: [813, 894], at: [813, 894] },
} as const;

// Voiceover line starts (seconds), matching SHOTS.at; see SCRIPT.md.
export const VO_STARTS = [0.15, 5.13, 10.0, 13.58, 17.3, 21.06, 24.86, 27.23];

export const XF = 6; // crossfade frames at each cut

export type Shot = { readonly design: readonly [number, number]; readonly at: readonly [number, number] };

export const Scene: React.FC<{ shot: Shot; first?: boolean; children: React.ReactNode }> = ({ shot, first, children }) => {
  const f = useCurrentFrame();
  const [s, e] = shot.at;
  const [ds, de] = shot.design;
  if (f < s || f >= e + XF) return null;
  const o = first ? 1 : interpolate(f, [s, s + XF], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const map = (fr: number) => ds + ((fr - s) * (de - ds)) / (e - s);
  return (
    <TimeCtx.Provider value={map}>
      <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
    </TimeCtx.Provider>
  );
};

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
    <defs>
      <linearGradient id="v-flame" x1="14" y1="4" x2="14" y2="23" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FF7A1A" />
        <stop offset="55%" stopColor="#4FA8FF" />
        <stop offset="100%" stopColor="#8FE3FF" />
      </linearGradient>
      <linearGradient id="v-orbit" x1="2" y1="14" x2="26" y2="14" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#8FE3FF" stopOpacity="0.9" />
        <stop offset="50%" stopColor="#A78BFA" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#FF7A1A" stopOpacity="0.9" />
      </linearGradient>
    </defs>
    <polygon points="14,1.8 22.6,5.4 26.2,14 22.6,22.6 14,26.2 5.4,22.6 1.8,14 5.4,5.4" stroke="rgba(143,227,255,0.32)" strokeWidth="0.6" fill="rgba(5,7,14,0.55)" />
    <ellipse cx="14" cy="15" rx="11.2" ry="4.4" transform="rotate(-24 14 15)" stroke="url(#v-orbit)" strokeWidth="1.1" />
    <path d="M14 4.5C14 4.5 19.6 10.6 19.6 15.4C19.6 18.7 17.1 21.4 14 21.4C10.9 21.4 8.4 18.7 8.4 15.4C8.4 10.6 14 4.5 14 4.5Z" fill="url(#v-flame)" stroke="#8FE3FF" strokeWidth="0.6" />
    <circle cx="14" cy="16" r="3.1" fill="#F8FAFC" />
    <circle cx="23.6" cy="10.8" r="1.5" fill="#FF7A1A" />
  </svg>
);

/** Words rise in one by one; words wrapped in *stars* use the ember accent. */
const Line: React.FC<{ text: string; start: number; end: number; size: number; color?: string }> = ({ text, start, end, size, color = C.ink }) => {
  const f = useT();
  const words = text.split(" ");
  const out = interpolate(f, [end - 8, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ fontFamily: display, fontWeight: 700, fontSize: size, lineHeight: 1.1, color, opacity: out, textAlign: "center" }}>
      {words.map((w, i) => {
        const s = start + i * 3;
        const o = interpolate(f, [s, s + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const y = interpolate(f, [s, s + 12], [28, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
        const accent = w.startsWith("*");
        return (
          <span key={i} style={{ display: "inline-block", opacity: o, transform: `translateY(${y}px)`, marginRight: "0.26em", color: accent ? C.ember : undefined }}>
            {w.replace(/\*/g, "")}
          </span>
        );
      })}
    </div>
  );
};

const Count: React.FC<{ to: number; start: number; dur?: number }> = ({ to, start, dur = 24 }) => {
  const f = useT();
  const t = interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  return <>{Math.round(to * t).toLocaleString("en-US")}</>;
};

// ---------- 1. Hook ----------
export const Hook: React.FC = () => {
  const f = useT();
  const glow = interpolate(f, [0, 119], [0.25, 0.55]);
  return (
    <AbsoluteFill style={{ background: C.void, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 58%, rgba(255,122,26,${glow * 0.35}) 0%, rgba(79,168,255,${glow * 0.12}) 28%, rgba(0,0,0,0) 55%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 160 }}>
        {f < 60 ? <Line text="In microgravity, fire behaves *differently.*" start={6} end={60} size={92} /> : <Line text="So what has NASA *actually* *tested?*" start={62} end={125} size={92} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- 2. Brand over the overview ----------
const BRAND_KEYS: Key[] = [
  { f: 119, cx: 960, cy: 540, z: 1.0 },
  { f: 238, cx: 900, cy: 470, z: 1.12 },
];
export const Brand: React.FC<{ video?: { src: string; at: number } }> = ({ video }) => {
  const f = useT();
  const markO = fadeWindow(f, 121, 182, 8);
  const scale = interpolate(f, [121, 145], [0.94, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const dim = interpolate(f, [170, 186], [0.78, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const blur = interpolate(f, [170, 186], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const statsO = fadeWindow(f, 186, 244, 8);
  return (
    <AbsoluteFill>
      {video ? <VideoCam src={video.src} at={video.at} keys={BRAND_KEYS} dim={dim} blur={blur} /> : <Cam src="ov-hero" keys={BRAND_KEYS} dim={dim} blur={blur} />}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: markO }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36, transform: `scale(${scale})` }}>
          <Logo size={150} />
          <div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 132, color: C.ink, lineHeight: 1 }}>Flame Atlas</div>
            <div style={{ fontFamily: sans, fontSize: 36, color: C.soft, marginTop: 14 }}>What NASA has tested, and where the evidence stops</div>
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 72, bottom: 64, opacity: statsO, display: "flex", gap: 18 }}>
        {[
          [24, "investigations"],
          [2009, "experiment rows"],
          [303, "publications"],
        ].map(([n, label], i) => (
          <div key={label} style={{ background: "rgba(0,0,0,0.86)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "16px 26px" }}>
            <div style={{ fontFamily: mono, fontSize: 52, color: C.ice }}>
              <Count to={n as number} start={188 + i * 4} />
            </div>
            <div style={{ fontFamily: sans, fontSize: 24, color: C.soft }}>{label}</div>
          </div>
        ))}
        <div style={{ alignSelf: "flex-end", fontFamily: mono, fontSize: 20, color: C.soft, letterSpacing: 2, background: "rgba(0,0,0,0.86)", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 16px" }}>FROM NASA PSI</div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 3. Overview: mission atmospheres, 21% then 34% ----------
const OV_A: Key[] = [
  { f: 238, cx: 690, cy: 330, z: 1.3 },
  { f: 290, cx: 690, cy: 345, z: 1.38 },
];
const OV_B: Key[] = [
  { f: 290, cx: 690, cy: 679, z: 1.38 },
  { f: 316, cx: 690, cy: 690, z: 1.42 },
  { f: 352, cx: 680, cy: 742, z: 1.62 },
];
export const Overview: React.FC = () => {
  const f = useT();
  const bO = interpolate(f, [290, 298], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Cam src="ov-missions-a" keys={OV_A} />
      <Cam src="ov-missions-b" keys={OV_B} opacity={bO} />
      <Mark keys={OV_B} x={300} y={756} w={745} h={30} start={318} end={358} />
      <Label n="01" kicker="Overview" title="Where does the evidence stop?" start={238} end={316} />
    </AbsoluteFill>
  );
};

// ---------- 4. Data analytics ----------
const AN_PLOT: Key[] = [
  { f: 355, cx: 1060, cy: 640, z: 1.05 },
  { f: 420, cx: 1080, cy: 690, z: 1.22 },
];
const AN_DETAIL: Key[] = [
  { f: 418, cx: 1340, cy: 470, z: 1.2 },
  { f: 476, cx: 1400, cy: 430, z: 1.32 },
];
export const Analytics: React.FC = () => {
  const f = useT();
  const dO = interpolate(f, [418, 426], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Cam src="lab-plot" keys={AN_PLOT} />
      <Cam src="lab-detail" keys={AN_DETAIL} opacity={dO} />
      <Label n="02" kicker="Data analytics" title="Every test, traced to its table" start={355} end={471} />
    </AbsoluteFill>
  );
};

// ---------- 5. Knowledge map: overview, search, a node's evidence path ----------
const MAP_ALL: Key[] = [
  { f: 471, cx: 900, cy: 560, z: 1.0 },
  { f: 520, cx: 880, cy: 540, z: 1.06 },
];
const MAP_SEARCH: Key[] = [
  { f: 518, cx: 880, cy: 540, z: 1.06 },
  { f: 572, cx: 860, cy: 600, z: 1.2 },
];
const MAP_NODE: Key[] = [
  { f: 570, cx: 980, cy: 560, z: 1.2 },
  { f: 646, cx: 1280, cy: 520, z: 1.5 },
];
const Typing: React.FC = () => {
  const f = useT();
  const n = Math.max(0, Math.min(5, Math.floor((f - 490) / 4)));
  const caret = Math.floor(f / 8) % 2 === 0;
  // Search box in map-all sits at x 279, y 135, 950x45 (capture px); camera ~z 1.03 there.
  const z = interpolate(f, [471, 520], [1.0, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cx = interpolate(f, [471, 520], [900, 880], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cy = interpolate(f, [471, 520], [560, 540], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f < 486) return null;
  return (
    <div
      style={{
        position: "absolute", left: 960 + (281 - cx) * z, top: 540 + (137 - cy) * z, width: 700 * z, height: 41 * z,
        background: C.panel, display: "flex", alignItems: "center", paddingLeft: 12 * z,
        fontFamily: sans, fontSize: 15 * z, color: C.ink, borderRadius: 6,
      }}
    >
      {"smoke".slice(0, n)}
      <span style={{ opacity: caret ? 1 : 0, marginLeft: 1, width: 2, height: 18 * z, background: C.ink, display: "inline-block" }} />
    </div>
  );
};
export const MapScene: React.FC = () => {
  const f = useT();
  const sO = interpolate(f, [518, 524], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const nO = interpolate(f, [570, 578], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Cam src="map-all" keys={MAP_ALL} />
      <Typing />
      <Cam src="map-search" keys={MAP_SEARCH} opacity={sO} />
      <Cam src="map-node" keys={MAP_NODE} opacity={nO} />
      <Mark keys={MAP_NODE} x={1514} y={484} w={372} h={150} start={600} end={648} />
      <Label n="03" kicker="Knowledge map" title="Every link traces back to NASA" start={471} end={600} />
    </AbsoluteFill>
  );
};

// ---------- 6. Compare with compatibility checks ----------
const CMP: Key[] = [
  { f: 642, cx: 1084, cy: 620, z: 1.15 },
  { f: 700, cx: 950, cy: 560, z: 1.35 },
  { f: 760, cx: 940, cy: 556, z: 1.4 },
];
export const Compare: React.FC = () => (
  <AbsoluteFill>
    <Cam src="map-compare" keys={CMP} />
    <Mark keys={CMP} x={300} y={521} w={1000} h={17} start={690} end={760} />
    <Label n="04" kicker="Compare" title="Compare only what is comparable" start={642} end={756} />
  </AbsoluteFill>
);

// ---------- 7. Research assistant ----------
const AS: Key[] = [
  { f: 756, cx: 1060, cy: 520, z: 1.1 },
  { f: 818, cx: 1000, cy: 470, z: 1.2 },
];
export const Assistant: React.FC<{ n?: string }> = ({ n = "05" }) => (
  <AbsoluteFill>
    <Cam src="as-answer" keys={AS} />
    <Label n={n} kicker="Research assistant" title="Answers that cite NASA" start={756} end={813} />
  </AbsoluteFill>
);

// ---------- 8. Outro ----------
export const Outro: React.FC<{ url?: string }> = ({ url }) => {
  const f = useT();
  const o = interpolate(f, [815, 832], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(f, [815, 838], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const sub = interpolate(f, [830, 846], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.void, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 46%, rgba(79,168,255,0.16) 0%, rgba(255,122,26,0.08) 30%, rgba(0,0,0,0) 58%)" }} />
      <div style={{ opacity: o, transform: `translateY(${y}px)`, display: "flex", alignItems: "center", gap: 34 }}>
        <Logo size={140} />
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 128, color: C.ink, lineHeight: 1 }}>Flame Atlas</div>
      </div>
      <div style={{ opacity: sub, marginTop: 34, textAlign: "center" }}>
        <div style={{ fontFamily: sans, fontSize: 38, color: C.soft }}>
          Know what NASA has tested, and where the <span style={{ color: C.ember }}>evidence stops.</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 22, color: C.muted, letterSpacing: 3, marginTop: 26 }}>
          NASA SPACE APPS 2026 · FLAME IN FREEFALL · DATA: NASA PSI
        </div>
        {url && <div style={{ fontFamily: mono, fontSize: 34, color: C.ice, marginTop: 30 }}>{url}</div>}
      </div>
    </AbsoluteFill>
  );
};

export const FlameAtlasDemo: React.FC<{ bgm: boolean }> = ({ bgm }) => {
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Scene shot={SHOTS.hook} first><Hook /></Scene>
      <Scene shot={SHOTS.brand}><Brand /></Scene>
      <Scene shot={SHOTS.overview}><Overview /></Scene>
      <Scene shot={SHOTS.analytics}><Analytics /></Scene>
      <Scene shot={SHOTS.map}><MapScene /></Scene>
      <Scene shot={SHOTS.compare}><Compare /></Scene>
      <Scene shot={SHOTS.assistant}><Assistant /></Scene>
      <Scene shot={SHOTS.outro}><Outro /></Scene>
      {bgm && (
        <Audio
          src={staticFile("audio/bgm.mp3")}
          volume={(fr) => interpolate(fr, [0, 10, 864, 893], [0, 0.85, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      )}
    </AbsoluteFill>
  );
};
