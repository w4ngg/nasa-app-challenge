import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { Analytics, Assistant, Brand, Compare, Hook, MapScene, Outro, Overview, Scene } from "./Main";
import { Cam, Key, Label, Mark, VideoCam, fadeWindow, useT } from "./parts";
import { C, display, easeOut, mono } from "./theme";

// 60 s extended cut on bgm60.mp3 (same song, ~123 BPM). Every `at` boundary is a bar
// of that track. Scenes shared with the 30 s cut keep their `design` timelines and are
// retimed; the new scenes (3D chamber, forecaster) are designed directly on `at`.
// 1794 frames = 59.8 s, which stays under 60 s after AAC padding.
export const SHOTS60 = {
  hook: { design: [0, 119], at: [0, 119] },
  brand: { design: [119, 238], at: [119, 238] },
  gravity: { design: [238, 529], at: [238, 529] },
  oxygen: { design: [529, 700], at: [529, 700] },
  overview: { design: [238, 355], at: [700, 876] },
  analytics: { design: [355, 471], at: [876, 1053] },
  map: { design: [471, 642], at: [1053, 1285] },
  compare: { design: [642, 756], at: [1285, 1403] },
  forecast: { design: [1403, 1576], at: [1403, 1576] },
  assistant: { design: [756, 813], at: [1576, 1693] },
  outro: { design: [813, 894], at: [1693, 1794] },
} as const;
export const DURATION60 = 1794;

/** Large state chip for the chamber scenes (top left, over the canvas). */
const Chip: React.FC<{ text: string; sub: string; start: number; end: number; color?: string }> = ({ text, sub, start, end, color = C.ice }) => {
  const f = useT();
  const o = fadeWindow(f, start, end, 8);
  const y = interpolate(f, [start, start + 12], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  return (
    <div style={{ position: "absolute", left: 72, top: 64, opacity: o, transform: `translateY(${y}px)` }}>
      <div style={{ background: "rgba(0,0,0,0.86)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "16px 26px" }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 64, color, lineHeight: 1 }}>{text}</div>
        <div style={{ fontFamily: mono, fontSize: 22, color: C.soft, marginTop: 10, letterSpacing: 1 }}>{sub}</div>
      </div>
    </div>
  );
};

// ---------- 3D chamber: gravity morph (recording chamber-gravity.mp4, from 2.5 s) ----------
const GRAV: Key[] = [
  { f: 238, cx: 960, cy: 540, z: 1.0 },
  { f: 290, cx: 770, cy: 452, z: 1.5 },
  { f: 529, cx: 760, cy: 446, z: 1.58 },
];
const Gravity: React.FC = () => (
  <AbsoluteFill>
    <VideoCam src="chamber-gravity" at={238} startFrom={75} keys={GRAV} />
    <Chip text="0 g · ISS" sub="Spherical diffusion flame" start={244} end={300} />
    <Chip text="1 g · Earth" sub="Buoyancy pulls it into a teardrop" start={384} end={488} color={C.ember} />
    <Chip text="0.17 g · Moon" sub="No solid burns tested at lunar gravity" start={492} end={540} />
    <Label n="3D" kicker="Flame chamber" title="Gravity reshapes the flame" start={238} end={380} />
  </AbsoluteFill>
);

// ---------- 3D chamber: oxygen to 34% (recording chamber-oxygen.mp4, from 0.6 s at 1.3x: 21% until ~f561, 34% from ~f654) ----------
const OXY: Key[] = [
  { f: 529, cx: 1000, cy: 560, z: 1.12 },
  { f: 700, cx: 1060, cy: 620, z: 1.2 },
];
const Oxygen: React.FC = () => (
  <AbsoluteFill>
    <VideoCam src="chamber-oxygen" at={529} startFrom={18} rate={1.3} keys={OXY} />
    <Chip text="21% O₂ · ISS air" sub="Inside the tested range" start={533} end={562} />
    <Chip text="34% O₂ · proposed habitat" sub="Solids tested only up to 22.2% (BASS-II)" start={652} end={706} color={C.ember} />
    <Label n="3D" kicker="Proposed 34% O₂ habitat" title="No solid burns on record at 34% O₂" start={529} end={700} />
  </AbsoluteFill>
);

// ---------- Burn time forecaster ----------
const FC_IN: Key[] = [
  { f: 1403, cx: 720, cy: 560, z: 1.18 },
  { f: 1480, cx: 700, cy: 600, z: 1.26 },
];
const FC_OUT: Key[] = [
  { f: 1476, cx: 1380, cy: 520, z: 1.3 },
  { f: 1580, cx: 1450, cy: 470, z: 1.42 },
];
const Forecast: React.FC = () => {
  const f = useT();
  const rO = interpolate(f, [1476, 1484], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Cam src="fc-input" keys={FC_IN} />
      <Mark keys={FC_IN} x={300} y={800} w={172} h={40} start={1448} end={1480} />
      <Cam src="fc-result" keys={FC_OUT} opacity={rO} />
      <Mark keys={FC_OUT} x={1156} y={300} w={720} h={214} start={1500} end={1580} />
      <Label n="05" kicker="Burn time forecaster" title="A forecast that shows its uncertainty" start={1403} end={1576} />
    </AbsoluteFill>
  );
};

export const FlameAtlasDemo60: React.FC<{ bgm: boolean }> = ({ bgm }) => (
  <AbsoluteFill style={{ background: C.void }}>
    <Scene shot={SHOTS60.hook} first><Hook /></Scene>
    <Scene shot={SHOTS60.brand}><Brand video={{ src: "overview-hero", at: 119 }} /></Scene>
    <Scene shot={SHOTS60.gravity}><Gravity /></Scene>
    <Scene shot={SHOTS60.oxygen}><Oxygen /></Scene>
    <Scene shot={SHOTS60.overview}><Overview /></Scene>
    <Scene shot={SHOTS60.analytics}><Analytics /></Scene>
    <Scene shot={SHOTS60.map}><MapScene /></Scene>
    <Scene shot={SHOTS60.compare}><Compare /></Scene>
    <Scene shot={SHOTS60.forecast}><Forecast /></Scene>
    <Scene shot={SHOTS60.assistant}><Assistant n="06" /></Scene>
    <Scene shot={SHOTS60.outro}><Outro url="flameatlas.percytony.com" /></Scene>
    {bgm && (
      <Audio
        src={staticFile("audio/bgm60.mp3")}
        volume={(fr) => interpolate(fr, [0, 10, DURATION60 - 30, DURATION60 - 1], [0, 0.85, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      />
    )}
  </AbsoluteFill>
);
