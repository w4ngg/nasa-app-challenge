// Connector Security, Input Sanitization, Numeric Clamping & HTTPS/SSRF Allowlist

export const ALLOWED_HTTPS_HOSTS = new Set([
  "psi.nasa.gov",
  "ntrs.nasa.gov",
  "doi.org",
  "dx.doi.org",
  "api.nasa.gov",
]);

const PRIVATE_OR_LOOPBACK_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?fe80:.*\]?)$/i;

/**
 * Strips control characters, HTML/script tags, and prompt-injection delimiters.
 */
export function sanitizeText(input: unknown, maxLength = 500): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Clamps an arbitrary input to [min, max], returning fallback if NaN/non-numeric.
 */
export function clampNumeric(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export interface UrlValidationResult {
  ok: boolean;
  sanitizedUrl?: string;
  reason?: string;
}

/**
 * Validates that an external URL uses HTTPS, is not a loopback/private SSRF target,
 * and belongs to the approved NASA / DOI scientific domain allowlist.
 */
export function validateHttpsAllowlist(rawUrl: unknown): UrlValidationResult {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, reason: "EMPTY_URL" };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: "INVALID_URL_FORMAT" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "HTTPS_REQUIRED" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_OR_LOOPBACK_HOST.test(hostname)) {
    return { ok: false, reason: "SSRF_PRIVATE_HOST_BLOCKED" };
  }
  if (!ALLOWED_HTTPS_HOSTS.has(hostname)) {
    return { ok: false, reason: `HOST_NOT_ALLOWLISTED:${hostname}` };
  }
  return { ok: true, sanitizedUrl: parsed.toString() };
}

export interface SanitizedPredictRequest {
  o2: number;
  gravity: number;
  pressureAtm: number;
  flowCmPerSec: number;
  fuel: string;
  targetUrl?: string;
}

export function sanitizePredictPayload(raw: Record<string, unknown>): {
  ok: boolean;
  data?: SanitizedPredictRequest;
  error?: string;
} {
  if (raw.targetUrl !== undefined) {
    const urlCheck = validateHttpsAllowlist(raw.targetUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: `Blocked targetUrl: ${urlCheck.reason}` };
    }
  }
  const o2 = clampNumeric(raw.o2, 0, 100, 21);
  const gravity = clampNumeric(raw.gravity, 0, 1, 0);
  const pressureAtm = clampNumeric(raw.pressureAtm, 0.1, 5.0, 1.0);
  const flowCmPerSec = clampNumeric(raw.flowCmPerSec, 0, 100, 10);
  const fuel = sanitizeText(raw.fuel ?? "PMMA", 80) || "PMMA";

  return {
    ok: true,
    data: {
      o2,
      gravity,
      pressureAtm,
      flowCmPerSec,
      fuel,
      targetUrl: typeof raw.targetUrl === "string" ? raw.targetUrl.trim() : undefined,
    },
  };
}

