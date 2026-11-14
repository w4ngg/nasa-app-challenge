import * as THREE from "three";

export const FLAME_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uG;
  uniform float uO2;
  uniform vec2 uWind;
  uniform float uScale;

  varying float vRadial;
  varying float vHeight;
  varying float vPhase;
  varying float vG;
  varying float vO2;

  void main() {
    float rNorm = aSeed.x;
    float theta = aSeed.y * 6.2831853;
    float phi = acos(clamp(2.0 * aSeed.z - 1.0, -1.0, 1.0));
    float phase = aSeed.w * 6.2831853;

    // 0g Microgravity spherical diffusion flame: inner core rCore + outer diffusion shell rShell with cellular oscillation cell
    float o2Boost = 0.78 + clamp(uO2 / 100.0, 0.1, 1.0) * 0.45;
    float cell = 0.06 * sin(4.0 * phi + uTime * 1.8 + phase) * cos(3.0 * theta - uTime * 1.3);
    float rCore = 0.38 * pow(rNorm, 0.65);
    float rShell = (0.76 + cell) * smoothstep(0.15, 1.0, rNorm);
    float rad0g = mix(rCore, rShell, smoothstep(0.0, 1.0, rNorm)) * o2Boost;

    vec3 dirSphere = vec3(
      sin(phi) * cos(theta),
      cos(phi),
      sin(phi) * sin(theta)
    );
    vec3 pu = dirSphere * rad0g;

    // 1g Buoyant teardrop flame: thermal swirl, turbulence fl, and mouse wind deflection uWind
    float h = fract(rNorm + uTime * (0.28 + 0.18 * aSeed.w));
    float taper = pow(max(0.0, 1.0 - h), 0.72) * (0.18 + 0.82 * sin(h * 3.1415926));
    float swirl = theta + h * 2.6 + uTime * 1.9;
    float fl = 0.085 * sin(h * 10.0 - uTime * 5.2 + phase) * h;

    vec3 pe = vec3(
      cos(swirl) * taper * 0.72 + fl + uWind.x * h * 0.55,
      (h * 1.95 - 0.72) * o2Boost,
      sin(swirl) * taper * 0.72 + fl * 0.6 + uWind.y * h * 0.35
    );

    // Morph smoothly between 0g sphere (pu) and 1g teardrop (pe)
    vec3 morphed = mix(pu, pe, clamp(uG, 0.0, 1.0)) * uScale;

    vRadial = clamp(rNorm, 0.0, 1.0);
    vHeight = clamp((morphed.y + 0.9) / 2.0, 0.0, 1.0);
    vPhase = aSeed.w;
    vG = clamp(uG, 0.0, 1.0);
    vO2 = clamp(uO2 / 100.0, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float baseSize = mix(15.0, 19.0, 1.0 - vRadial) * uScale;
    gl_PointSize = clamp(baseSize * (1.0 / max(0.4, -mvPosition.z)), 1.5, 28.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const FLAME_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uSprite;
  varying float vRadial;
  varying float vHeight;
  varying float vPhase;
  varying float vG;
  varying float vO2;

  void main() {
    vec4 tex = texture2D(uSprite, gl_PointCoord);
    if (tex.a < 0.02) discard;

    // 0g cool spherical flame spectrum: violet -> cyan -> ice
    vec3 violet = vec3(0.655, 0.545, 0.980); // #A78BFA
    vec3 cyan   = vec3(0.310, 0.659, 1.000); // #4FA8FF
    vec3 ice    = vec3(0.561, 0.890, 1.000); // #8FE3FF

    vec3 col0g = mix(ice, cyan, smoothstep(0.0, 0.62, vRadial));
    col0g = mix(col0g, violet, smoothstep(0.55, 1.0, vRadial));

    // 1g buoyant flame spectrum: bBlue -> yellow -> orange -> red
    vec3 bBlue  = vec3(0.28, 0.58, 1.00);
    vec3 yellow = vec3(1.00, 0.91, 0.54);
    vec3 orange = vec3(1.00, 0.48, 0.10);
    vec3 red    = vec3(0.92, 0.20, 0.24);

    vec3 col1g = mix(bBlue, yellow, smoothstep(0.05, 0.35, vHeight));
    col1g = mix(col1g, orange, smoothstep(0.35, 0.72, vHeight));
    col1g = mix(col1g, red, smoothstep(0.70, 1.0, vHeight));

    vec3 finalColor = mix(col0g, col1g, vG);
    // Enrich brightness with oxygen concentration
    finalColor *= (0.82 + 0.48 * vO2);

    float alpha = tex.a * mix(0.42, 0.18, vRadial) * (0.7 + 0.3 * sin(vPhase * 6.283));
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.88));
  }
`;

// Fix small typo in GLSL snippet above? Wait: notice `vec3 dir Sphere = vec3(` on line 24! Let's fix `dir Sphere` -> `dirSphere` right now!
export const SAFE_FLAME_VERTEX_SHADER = FLAME_VERTEX_SHADER.replace("vec3 dir Sphere =", "vec3 dirSphere =");

/**
 * Generates a 64x64 soft radial gradient CanvasTexture for GPU additive point sprites.
 */
export function createSoftCircleTexture(): THREE.Texture {
  if (typeof document === "undefined") {
    return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    grad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    grad.addColorStop(0.35, "rgba(235, 248, 255, 0.75)");
    grad.addColorStop(0.7, "rgba(160, 215, 255, 0.22)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
