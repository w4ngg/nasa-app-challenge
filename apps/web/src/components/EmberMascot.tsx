import { useEffect, useMemo, useRef, useState } from "react";
import { describeFlameRegime, getEmberGradientStops, interpolateEmberPath, lerp } from "../lib/physics";

export interface EmberMascotProps {
  gravity: number;
  o2: number;
  narrationText?: string;
}

const DEFAULT_NARRATION =
  "At microgravity zero G, buoyancy disappears and flames form a cool blue spherical diffusion shell. For solid fuels on the ISS, NASA PSI tables record chamber oxygen up to 22.2 percent in BASS-II, leaving a critical data gap at 34 percent exploration cabin oxygen.";

export function EmberMascot({ gravity, o2, narrationText = DEFAULT_NARRATION }: EmberMascotProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [look, setLook] = useState({ x: 0, y: 0, tilt: 0 });
  const targetLook = useRef({ x: 0, y: 0, tilt: 0 });
  const [speaking, setSpeaking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0.15);
  const [activeWordIdx, setActiveWordIdx] = useState<number>(-1);

  const words = useMemo(() => narrationText.trim().split(/\s+/), [narrationText]);
  const stops = getEmberGradientStops(gravity);
  const pathD = interpolateEmberPath(gravity);
  const regime = describeFlameRegime(gravity, o2);

  // Smooth pupil & body tilt tracking via lerp
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 180));
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 180));
      targetLook.current = { x: dx * 6.5, y: dy * 5.0, tilt: dx * 7.5 };
    };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      setLook((prev) => ({
        x: lerp(prev.x, targetLook.current.x, 0.14),
        y: lerp(prev.y, targetLook.current.y, 0.14),
        tilt: lerp(prev.tilt, targetLook.current.tilt, 0.12),
      }));
    };
    tick();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  // Lip-sync mouth oscillation while speaking
  useEffect(() => {
    if (!speaking) {
      setMouthOpen(0.15);
      return;
    }
    const timer = window.setInterval(() => {
      setMouthOpen(0.25 + Math.abs(Math.sin(Date.now() * 0.022)) * 0.75);
    }, 55);
    return () => window.clearInterval(timer);
  }, [speaking]);

  const toggleSpeech = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      setActiveWordIdx(-1);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(narrationText);
    utter.rate = 1.02;
    utter.pitch = 1.08;
    utter.onboundary = (event) => {
      if (event.name === "word" || typeof event.charIndex === "number") {
        const prefix = narrationText.slice(0, event.charIndex);
        const idx = prefix.trim() ? prefix.trim().split(/\s+/).length : 0;
        setActiveWordIdx(Math.min(words.length - 1, idx));
      }
    };
    utter.onend = () => {
      setSpeaking(false);
      setActiveWordIdx(-1);
    };
    utter.onerror = () => {
      setSpeaking(false);
      setActiveWordIdx(-1);
    };
    setSpeaking(true);
    setActiveWordIdx(0);
    window.speechSynthesis.speak(utter);
  };

  const browOffset = regime.mood === "alert" ? -4 : regime.mood === "hypoxic" ? 3 : 0;
  const mouthHeight = Math.round(3 + mouthOpen * 11);

  return (
    <div className="panel" style={{ display: "grid", gap: 12 }}>
      <div className="ember-head">
        <div>
          <span className="eyebrow" style={{ display: "block", marginBottom: 2 }}>
            Interactive Vector Mascot · Cubic Bezier 0g↔1g
          </span>
          <h3 style={{ margin: 0 }}>Ember Telemetry Guide</h3>
        </div>
        <button type="button" onClick={toggleSpeech} style={{ fontSize: 12, padding: "6px 12px" }}>
          {speaking ? "Stop TTS Lip-Sync" : "Speak Telemetry (TTS)"}
        </button>
      </div>

      <div className="ember-body">
        <svg
          ref={svgRef}
          viewBox="0 0 200 200"
          width="136"
          height="136"
          role="img"
          aria-label={`Ember mascot at ${gravity}g and ${o2}% oxygen`}
        >
          <defs>
            <radialGradient id="ember-body-grad" cx="50%" cy="54%" r="52%">
              <stop offset="0%" stopColor={stops.inner} />
              <stop offset="56%" stopColor={stops.mid} />
              <stop offset="100%" stopColor={stops.outer} />
            </radialGradient>
            <filter id="ember-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="7.5" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={`rotate(${look.tilt.toFixed(2)} 100 115)`}>
            {/* Morphing Cubic Bezier Flame Body */}
            <path d={pathD} fill="url(#ember-body-grad)" filter="url(#ember-glow)" />

            {/* Expressive Eyes & Tracking Pupils */}
            <g transform={`translate(${look.x.toFixed(2)}, ${look.y.toFixed(2)})`}>
              <line x1="70" y1={86 + browOffset} x2="88" y2={88 - browOffset} stroke="#05070E" strokeWidth="3.2" strokeLinecap="round" />
              <line x1="112" y1={88 - browOffset} x2="130" y2={86 + browOffset} stroke="#05070E" strokeWidth="3.2" strokeLinecap="round" />

              <circle cx="80" cy="98" r="9" fill="#05070E" />
              <circle cx="120" cy="98" r="9" fill="#05070E" />
              <circle cx={82 + look.x * 0.25} cy={96 + look.y * 0.25} r="3.2" fill="#FFFFFF" />
              <circle cx={122 + look.x * 0.25} cy={96 + look.y * 0.25} r="3.2" fill="#FFFFFF" />

              {/* Lip-synced Mouth */}
              {speaking || regime.mood === "alert" ? (
                <rect
                  x="90"
                  y={114 - mouthHeight / 2}
                  width="20"
                  height={mouthHeight}
                  rx="6"
                  fill="#05070E"
                />
              ) : (
                <path
                  d={regime.mood === "hypoxic" ? "M 88 120 Q 100 112 112 120" : "M 86 114 Q 100 124 114 114"}
                  fill="none"
                  stroke="#05070E"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              )}
            </g>
          </g>
        </svg>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span className="obsidian-swatch-pill">
              <span className="obsidian-swatch-dot" style={{ background: stops.inner }} />
              Inner {stops.inner}
            </span>
            <span className="obsidian-swatch-pill">
              <span className="obsidian-swatch-dot" style={{ background: stops.mid }} />
              Mid {stops.mid}
            </span>
            <span className="obsidian-swatch-pill">
              <span className="obsidian-swatch-dot" style={{ background: stops.outer }} />
              Outer {stops.outer}
            </span>
          </div>

          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-soft)" }} aria-live="polite">
            {words.map((word, idx) => (
              <span
                key={`${word}-${idx}`}
                style={
                  idx === activeWordIdx
                    ? {
                        background: "rgba(79, 168, 255, 0.28)",
                        color: "var(--ice)",
                        padding: "1px 4px",
                        borderRadius: 4,
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}

