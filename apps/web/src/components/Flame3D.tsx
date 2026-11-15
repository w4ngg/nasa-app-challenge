import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FLAME_FRAGMENT_SHADER, FLAME_VERTEX_SHADER, createSoftCircleTexture } from "../lib/flameShaders";
import { describeFlameRegime, getEmberGradientStops, interpolateEmberPath } from "../lib/physics";

const FULL_PARTICLES = 24_000;
const REDUCED_PARTICLES = 10_000;
const STAR_PARTICLES = 1_200;

function detectWebGLSupport(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

export interface Flame3DProps {
  gravity: number; // 0.0 (0g ISS) to 1.0 (1g Earth)
  o2: number; // 0 to 100%
  fuelName?: string;
  force2DFallback?: boolean;
}

export function Flame3D({ gravity, o2, fuelName = "Ethylene (C₂H₄)", force2DFallback = false }: Flame3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglReady, setWebglReady] = useState<boolean>(() => !force2DFallback && detectWebGLSupport());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const [manual2D, setManual2D] = useState(false);

  const uniformsRef = useRef<{
    uTime: { value: number };
    uG: { value: number };
    uO2: { value: number };
    uWind: { value: THREE.Vector2 };
    uScale: { value: number };
    uSprite: { value: THREE.Texture };
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uG.value = gravity;
      uniformsRef.current.uO2.value = o2;
    }
  }, [gravity, o2]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || force2DFallback || manual2D || !webglReady) return;

    const particleCount = reducedMotion ? REDUCED_PARTICLES : FULL_PARTICLES;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setWebglReady(false);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(host.clientWidth || 640, host.clientHeight || 440);
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, (host.clientWidth || 640) / (host.clientHeight || 440), 0.1, 100);
    camera.position.set(0, 0.25, 4.1);

    const spriteTex = createSoftCircleTexture();

    // 1. Primary 24,000 (or 10,000 reduced-motion) GPU Flame Particle System
    const flameGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount * 4);
    for (let i = 0; i < particleCount; i++) {
      const i4 = i * 4;
      seeds[i4] = Math.random();
      seeds[i4 + 1] = Math.random();
      seeds[i4 + 2] = Math.random();
      seeds[i4 + 3] = Math.random();
    }
    flameGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    flameGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));

    const uniforms = {
      uTime: { value: 0 },
      uG: { value: gravity },
      uO2: { value: o2 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uScale: { value: 1.0 },
      uSprite: { value: spriteTex },
    };
    uniformsRef.current = uniforms;

    const flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX_SHADER,
      fragmentShader: FLAME_FRAGMENT_SHADER,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flamePoints = new THREE.Points(flameGeo, flameMat);
    scene.add(flamePoints);

    // 2. Auxiliary 1,200 Galaxy Star Particles (3-arm spiral + spherical halo)
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(STAR_PARTICLES * 3);
    const starCol = new Float32Array(STAR_PARTICLES * 3);
    for (let i = 0; i < STAR_PARTICLES; i++) {
      const i3 = i * 3;
      const arm = i % 3;
      const r = 1.8 + Math.pow(Math.random(), 0.7) * 5.2;
      const spiralAngle = (arm * (Math.PI * 2)) / 3 + r * 0.85 + (Math.random() - 0.5) * 0.55;
      const sphericalMix = i < STAR_PARTICLES * 0.65 ? 0.25 : 1.0;
      starPos[i3] = Math.cos(spiralAngle) * r;
      starPos[i3 + 1] = (Math.random() - 0.5) * r * sphericalMix;
      starPos[i3 + 2] = Math.sin(spiralAngle) * r - 1.8;
      // Colors: mix of --ice (#8FE3FF), --blue (#4FA8FF), and --violet (#A78BFA)
      starCol[i3] = 0.45 + Math.random() * 0.4;
      starCol[i3 + 1] = 0.65 + Math.random() * 0.3;
      starCol[i3 + 2] = 0.98;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.045,
      map: spriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // 3. Dual Counter-Rotating TorusGeometry Rings + Orbiting Satellites
    const ringGroupA = new THREE.Group();
    const ringGroupB = new THREE.Group();
    const torusGeoA = new THREE.TorusGeometry(1.42, 0.008, 12, 96);
    const torusGeoB = new THREE.TorusGeometry(1.68, 0.006, 12, 96);
    const ringMatA = new THREE.MeshBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.32 });
    const ringMatB = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.24 });
    ringGroupA.add(new THREE.Mesh(torusGeoA, ringMatA));
    ringGroupB.add(new THREE.Mesh(torusGeoB, ringMatB));

    const satGeo = new THREE.OctahedronGeometry(0.045, 0);
    const satMeshA = new THREE.Mesh(satGeo, new THREE.MeshBasicMaterial({ color: 0x8fe3ff }));
    satMeshA.position.set(1.42, 0, 0);
    ringGroupA.add(satMeshA);

    const satMeshB = new THREE.Mesh(satGeo, new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    satMeshB.position.set(-1.68, 0, 0);
    ringGroupB.add(satMeshB);

    ringGroupA.rotation.x = Math.PI * 0.36;
    ringGroupB.rotation.x = -Math.PI * 0.28;
    ringGroupB.rotation.z = Math.PI * 0.18;
    scene.add(ringGroupA, ringGroupB);

    // 4. IcosahedronGeometry Wireframe + Point Cloud Chamber Cage
    const icoGeo = new THREE.IcosahedronGeometry(1.22, 1);
    const icoWire = new THREE.Mesh(
      icoGeo,
      new THREE.MeshBasicMaterial({ color: 0x4fa8ff, wireframe: true, transparent: true, opacity: 0.11 }),
    );
    const icoCloud = new THREE.Points(
      icoGeo,
      new THREE.PointsMaterial({ color: 0x8fe3ff, size: 0.04, transparent: true, opacity: 0.55 }),
    );
    scene.add(icoWire, icoCloud);

    // Mouse wind handler
    const targetWind = new THREE.Vector2(0, 0);
    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      targetWind.set(nx * 0.45, ny * 0.25);
    };
    host.addEventListener("pointermove", onPointerMove);

    // ResizeObserver auto-scaling combustion chamber
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(240, entry.contentRect.width);
      const h = Math.max(240, entry.contentRect.height);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      uniforms.uScale.value = Math.min(1.18, Math.max(0.75, Math.min(w, h) / 420));
    });
    ro.observe(host);

    let rafId = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      rafId = window.requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      if (!reducedMotion) {
        uniforms.uTime.value = elapsed;
        uniforms.uWind.value.lerp(targetWind, Math.min(1, dt * 6));
        ringGroupA.rotation.z += dt * 0.38;
        ringGroupB.rotation.z -= dt * 0.29;
        icoWire.rotation.y += dt * 0.12;
        icoCloud.rotation.y += dt * 0.12;
        starField.rotation.y += dt * 0.03;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      flameGeo.dispose();
      flameMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      torusGeoA.dispose();
      torusGeoB.dispose();
      icoGeo.dispose();
      spriteTex.dispose();
      renderer.dispose();
    };
  }, [force2DFallback, manual2D, webglReady, reducedMotion]);

  const regime = describeFlameRegime(gravity, o2);
  const stops = getEmberGradientStops(gravity);
  const pathD = interpolateEmberPath(gravity);
  const show2D = force2DFallback || manual2D || !webglReady;

  return (
    <div className="flame-viewport" role="region" aria-label={`Combustion Chamber Simulation: ${fuelName}`}>
      <div className="flame-hud">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="flame-badge">
            {show2D ? "2D SVG Chamber Fallback" : `${(reducedMotion ? REDUCED_PARTICLES : FULL_PARTICLES).toLocaleString("en-US")} GPU Particles`}
          </span>
          <span className="flame-badge">
            {gravity.toFixed(2)}g · {o2.toFixed(1)}% O₂ · {fuelName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setManual2D((v) => !v)}
          style={{ pointerEvents: "auto", fontSize: 12, padding: "4px 10px" }}
        >
          {show2D ? "Switch to 3D WebGL" : "2D Chamber View"}
        </button>
      </div>

      {show2D ? (
        <div style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", padding: 24 }}>
          <svg viewBox="0 0 200 200" style={{ width: "min(72%, 340px)", height: "100%", maxHeight: "76%" }} aria-label="2D Fallback Microgravity Flame">
            <defs>
              <radialGradient id="chamber2d-grad" cx="50%" cy="55%" r="50%">
                <stop offset="0%" stopColor={stops.inner} />
                <stop offset="55%" stopColor={stops.mid} />
                <stop offset="100%" stopColor={stops.outer} stopOpacity="0.15" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="82" fill="none" stroke="var(--line-strong)" strokeDasharray="4 4" />
            <path d={pathD} fill="url(#chamber2d-grad)" />
          </svg>
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      )}

      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <span className="flame-badge">{regime.regimeLabel}</span>
        <span className={`status-pill ${regime.solidEvidenceState === "VERIFIED_PSI_CSV" ? "ok" : "alert"}`}>
          {regime.solidEvidenceState === "VERIFIED_PSI_CSV" ? "PSI CSV VERIFIED" : "BOUNDARY / GAP"}
        </span>
      </div>
    </div>
  );
}

