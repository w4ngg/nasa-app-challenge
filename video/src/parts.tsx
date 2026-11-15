import React, { createContext, useContext } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, display, easeCam, easeOut, mono } from "./theme";

/**
 * Scenes are designed on their original timeline; a Scene maps the composition frame
 * onto it (shift plus uniform stretch) so cuts can follow the voiceover.
 */
export const TimeCtx = createContext<((f: number) => number) | null>(null);
export const useT = (): number => {
  const f = useCurrentFrame();
  const map = useContext(TimeCtx);
  return map ? map(f) : f;
};

export type Key = { f: number; cx: number; cy: number; z: number };

/**
 * Camera over one 1920x1080 app capture (texture is 2x). Scaling is done by
 * changing the image's layout size, not a CSS transform, so text stays sharp
 * up to 2x zoom. (cx, cy) is the capture point placed at the frame centre.
 */
export const Cam: React.FC<{ src: string; keys: Key[]; opacity?: number; dim?: number; blur?: number }> = ({ src, keys, opacity = 1, dim = 0, blur = 0 }) => {
  const f = useT();
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (f >= keys[i].f && f <= keys[i + 1].f) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = a.f === b.f ? 1 : interpolate(f, [a.f, b.f], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeCam });
  const z = a.z + (b.z - a.z) * t;
  const cx = a.cx + (b.cx - a.cx) * t;
  const cy = a.cy + (b.cy - a.cy) * t;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden", background: C.void }}>
      <Img
        src={staticFile(`captures/${src}.png`)}
        style={{ position: "absolute", width: 1920 * z, height: 1080 * z, left: 960 - cx * z, top: 540 - cy * z, filter: blur ? `blur(${blur}px)` : undefined }}
      />
      {dim > 0 && <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />}
    </AbsoluteFill>
  );
};

/** Fade helper: 0 -> 1 over [a, a+d], 1 -> 0 over [b-d, b]. */
export const fadeWindow = (f: number, a: number, b: number, d = 6) =>
  Math.min(
    interpolate(f, [a, a + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(f, [b - d, b], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );

/** Section label in the lower left: mono kicker plus a display headline. */
export const Label: React.FC<{ n: string; kicker: string; title: string; start: number; end: number }> = ({ n, kicker, title, start, end }) => {
  const f = useT();
  const o = fadeWindow(f, start + 4, end, 7);
  const y = interpolate(f, [start + 4, start + 18], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  return (
    <div style={{ position: "absolute", left: 72, bottom: 64, opacity: o, transform: `translateY(${y}px)` }}>
      <div
        style={{
          background: "rgba(0,0,0,0.86)", border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.ember}`,
          borderRadius: 10, padding: "20px 30px 24px", boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 3, color: C.ice, textTransform: "uppercase" }}>
          {n} · {kicker}
        </div>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 56, color: C.ink, marginTop: 6, lineHeight: 1.05 }}>{title}</div>
      </div>
    </div>
  );
};

/** A rounded highlight frame drawn around a capture region (capture px, mapped through the camera). */
export const Mark: React.FC<{ keys: Key[]; x: number; y: number; w: number; h: number; start: number; end: number }> = ({ keys, x, y, w, h, start, end }) => {
  const f = useT();
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (f >= keys[i].f && f <= keys[i + 1].f) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = a.f === b.f ? 1 : interpolate(f, [a.f, b.f], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeCam });
  const z = a.z + (b.z - a.z) * t;
  const cx = a.cx + (b.cx - a.cx) * t;
  const cy = a.cy + (b.cy - a.cy) * t;
  const o = fadeWindow(f, start, end, 6);
  const grow = interpolate(f, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const pad = 10;
  return (
    <div
      style={{
        position: "absolute",
        left: 960 + (x - cx) * z - pad, top: 540 + (y - cy) * z - pad,
        width: (w * z + pad * 2) * grow, height: h * z + pad * 2,
        border: `3px solid ${C.ember}`, borderRadius: 10, opacity: o,
        boxShadow: `0 0 0 9999px rgba(0,0,0,${0.45 * o})`,
      }}
    />
  );
};

/**
 * Camera over a screen recording (1920x1080). `at` is the composition frame where the
 * recording starts playing; `startFrom` skips into the clip (frames); `rate` slows or speeds it.
 */
export const VideoCam: React.FC<{ src: string; at: number; keys: Key[]; startFrom?: number; rate?: number; opacity?: number; dim?: number; blur?: number }> = ({ src, at, keys, startFrom = 0, rate = 1, opacity = 1, dim = 0, blur = 0 }) => {
  const f = useT();
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (f >= keys[i].f && f <= keys[i + 1].f) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const t = a.f === b.f ? 1 : interpolate(f, [a.f, b.f], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeCam });
  const z = a.z + (b.z - a.z) * t;
  const cx = a.cx + (b.cx - a.cx) * t;
  const cy = a.cy + (b.cy - a.cy) * t;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden", background: C.void }}>
      <Sequence from={at} layout="none">
        <OffthreadVideo
          src={staticFile(`clips/${src}.mp4`)}
          startFrom={startFrom}
          playbackRate={rate}
          muted
          style={{ position: "absolute", width: 1920 * z, height: 1080 * z, left: 960 - cx * z, top: 540 - cy * z, filter: blur ? `blur(${blur}px)` : undefined }}
        />
      </Sequence>
      {dim > 0 && <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />}
    </AbsoluteFill>
  );
};
