import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ThemeMode } from "./tokens";

const GALAXY_STARS = 4500;
const DUST_CLOUDS = 600;

const VERTEX_SHADER = /* glsl */ `
  attribute float aScale;
  attribute vec3 aRandomness;
  uniform float uTime;
  uniform float uSize;
  varying vec3 vColor;

  void main() {
    vColor = color;
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);

    // Differential Keplerian spiral rotation around galaxy core
    float angle = atan(modelPosition.x, modelPosition.z);
    float dist = length(modelPosition.xz);
    float angleOffset = (1.0 / max(0.35, dist)) * uTime * 0.18;
    angle += angleOffset;

    modelPosition.x = cos(angle) * dist + aRandomness.x * 0.15;
    modelPosition.z = sin(angle) * dist + aRandomness.z * 0.15;
    modelPosition.y += sin(uTime * 0.7 + dist * 2.0) * 0.06 + aRandomness.y * 0.12;

    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uSize * aScale * (1.0 / max(0.5, -viewPosition.z)), 1.2, 28.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uAlphaGain;
  varying vec3 vColor;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    if (d > 0.5) discard;
    float strength = pow(1.0 - d * 2.0, 2.0);
    gl_FragColor = vec4(vColor, clamp(strength * uAlphaGain, 0.0, 0.95));
  }
`;

export function useGpuBackendInfo() {
  const [backend, setBackend] = useState<"WebGPU + WebGL2" | "WebGL2 Shader">("WebGL2 Shader");
  useEffect(() => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } };
    if (nav.gpu && typeof nav.gpu.requestAdapter === "function") {
      nav.gpu
        .requestAdapter()
        .then((adapter) => {
          if (adapter) setBackend("WebGPU + WebGL2");
        })
        .catch(() => undefined);
    }
  }, []);
  return backend;
}

function populateGalaxyColors(colors: Float32Array, radii: Float32Array, theme: ThemeMode) {
  const isLight = theme === "carbon-light";
  const colorCore = new THREE.Color(isLight ? "#0043CE" : "#8FE3FF");
  const colorArm = new THREE.Color(isLight ? "#0F62FE" : "#4FA8FF");
  const colorOuter = new THREE.Color(isLight ? "#6929C4" : "#A78BFA");
  const colorEmber = new THREE.Color(isLight ? "#D9460F" : "#FF7A1A");

  for (let i = 0; i < radii.length; i++) {
    const i3 = i * 3;
    const radius = radii[i];
    const mixed = colorCore.clone();
    mixed.lerp(colorArm, Math.min(1, radius / 2.8));
    mixed.lerp(colorOuter, Math.min(1, radius / 5.5));
    if (i % 15 === 0) mixed.lerp(colorEmber, 0.72);
    colors[i3] = mixed.r;
    colors[i3 + 1] = mixed.g;
    colors[i3 + 2] = mixed.b;
  }
}

export function GalaxyBackdrop({ theme }: { theme: ThemeMode }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const themeUpdateRef = useRef<((nextTheme: ThemeMode) => void) | null>(null);

  useEffect(() => {
    themeUpdateRef.current?.(theme);
  }, [theme]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 2.3, 5.5);
    camera.lookAt(0, 0, 0);

    // 4-Arm Spiral Galaxy + Volumetric Nebula Dust (Always On)
    const total = GALAXY_STARS + DUST_CLOUDS;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const scales = new Float32Array(total);
    const randomness = new Float32Array(total * 3);
    const radii = new Float32Array(total);

    for (let i = 0; i < total; i++) {
      const i3 = i * 3;
      const isDust = i >= GALAXY_STARS;
      const radius = Math.pow(Math.random(), 1.45) * 6.8 + 0.15;
      radii[i] = radius;
      const branches = 4;
      const branchAngle = ((i % branches) / branches) * Math.PI * 2;
      const spinAngle = radius * 1.35;

      const rx = Math.pow(Math.random(), 2.6) * (Math.random() < 0.5 ? 1 : -1) * 0.45 * radius;
      const ry = Math.pow(Math.random(), 2.8) * (Math.random() < 0.5 ? 1 : -1) * 0.22 * radius;
      const rz = Math.pow(Math.random(), 2.6) * (Math.random() < 0.5 ? 1 : -1) * 0.45 * radius;

      positions[i3] = Math.cos(branchAngle + spinAngle) * radius;
      positions[i3 + 1] = ry;
      positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius;

      randomness[i3] = rx;
      randomness[i3 + 1] = ry;
      randomness[i3 + 2] = rz;
      scales[i] = isDust ? 2.8 + Math.random() * 2.5 : 0.65 + Math.random() * 1.65;
    }

    populateGalaxyColors(colors, radii, theme);

    const colorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", colorAttr);
    geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute("aRandomness", new THREE.BufferAttribute(randomness, 3));

    const uniforms = {
      uTime: { value: 0 },
      uSize: { value: 19 * dpr },
      uAlphaGain: { value: theme === "carbon-light" ? 0.62 : 0.85 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: theme === "carbon-light" ? THREE.NormalBlending : THREE.AdditiveBlending,
      vertexColors: true,
    });

    const galaxyPoints = new THREE.Points(geometry, material);
    galaxyPoints.rotation.x = 0.28;
    galaxyPoints.rotation.z = -0.16;
    scene.add(galaxyPoints);

    // Dual 3D Orbital Telemetry Rings in deep space background
    const ringGeoA = new THREE.TorusGeometry(3.5, 0.007, 12, 140);
    const ringGeoB = new THREE.TorusGeometry(4.4, 0.005, 12, 140);
    const ringMatA = new THREE.MeshBasicMaterial({
      color: theme === "carbon-light" ? 0x0f62fe : 0x4fa8ff,
      transparent: true,
      opacity: theme === "carbon-light" ? 0.22 : 0.16,
    });
    const ringMatB = new THREE.MeshBasicMaterial({
      color: theme === "carbon-light" ? 0x6929c4 : 0xa78bfa,
      transparent: true,
      opacity: theme === "carbon-light" ? 0.18 : 0.12,
    });
    const orbitalRingA = new THREE.Mesh(ringGeoA, ringMatA);
    const orbitalRingB = new THREE.Mesh(ringGeoB, ringMatB);
    orbitalRingA.rotation.x = Math.PI * 0.42;
    orbitalRingB.rotation.x = -Math.PI * 0.36;
    orbitalRingB.rotation.y = Math.PI * 0.14;
    scene.add(orbitalRingA, orbitalRingB);

    // Live theme adaptation callback without recreating WebGL context
    themeUpdateRef.current = (nextTheme: ThemeMode) => {
      const isLight = nextTheme === "carbon-light";
      populateGalaxyColors(colors, radii, nextTheme);
      colorAttr.needsUpdate = true;
      uniforms.uAlphaGain.value = isLight ? 0.62 : 0.85;
      material.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
      material.needsUpdate = true;
      ringMatA.color.setHex(isLight ? 0x0f62fe : 0x4fa8ff);
      ringMatA.opacity = isLight ? 0.22 : 0.16;
      ringMatB.color.setHex(isLight ? 0x6929c4 : 0xa78bfa);
      ringMatB.opacity = isLight ? 0.18 : 0.12;
    };

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 1.4;
      pointer.y = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 0.9;
    };
    window.addEventListener("pointermove", onPointerMove);

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      if (!reducedMotion) {
        uniforms.uTime.value = t;
        camera.position.x += (pointer.x - camera.position.x) * 0.04;
        camera.position.y += (2.3 - pointer.y - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);
        orbitalRingA.rotation.z = t * 0.08;
        orbitalRingB.rotation.z = -t * 0.06;
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      themeUpdateRef.current = null;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      ringGeoA.dispose();
      ringGeoB.dispose();
      ringMatA.dispose();
      ringMatB.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="galaxy-backdrop" aria-hidden="true" />;
}
