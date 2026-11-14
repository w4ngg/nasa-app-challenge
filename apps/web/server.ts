import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGroundedPipelineSync } from "./src/lib/groundedPipeline.ts";
import { describeFlameRegime } from "./src/lib/physics.ts";
import { sanitizePredictPayload, sanitizeText } from "./src/lib/security.ts";
import type { Investigation, Publication } from "./src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "public/data");
const PUBLIC_DIR = path.resolve(__dirname, "public");
const DIST_DIR = path.resolve(__dirname, "dist");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const LLM_TIMEOUT_MS = 3000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

interface CatalogSnapshot {
  sha256: string;
  investigations: Investigation[];
  publications: Publication[];
}

let cachedCatalog: CatalogSnapshot | null = null;

export function loadCatalogWithSha256(): CatalogSnapshot {
  if (cachedCatalog) return cachedCatalog;
  const raw = fs.readFileSync(INDEX_PATH, "utf-8");
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const parsed = JSON.parse(raw) as {
    investigations: Investigation[];
    publications: Publication[];
  };
  cachedCatalog = {
    sha256,
    investigations: parsed.investigations ?? [],
    publications: parsed.publications ?? [],
  };
  return cachedCatalog;
}

async function synthesizeWithGeminiTimeout(question: string, contextText: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), LLM_TIMEOUT_MS);
  });

  const callPromise = ai.models
    .generateContent({
      model: "gemini-2.5-flash",
      contents: [
        "You are a zero-fabrication NASA PSI microgravity combustion evidence assistant.",
        "Use ONLY the verified evidence chunks below. Cite every claim with [S1], [S2], etc.",
        `Evidence:\n${contextText}`,
        `Question: ${question}`,
      ].join("\n\n"),
    })
    .then((res) => res.text ?? null)
    .catch(() => null);

  return Promise.race([callPromise, timeoutPromise]);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf-8");
      if (raw.length > 65536) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function tryServeStatic(pathname: string, res: ServerResponse): boolean {
  const decoded = decodeURIComponent(pathname);
  const relPath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  for (const baseDir of [DIST_DIR, PUBLIC_DIR]) {
    const candidate = path.resolve(baseDir, relPath);
    if (!candidate.startsWith(baseDir)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      fs.createReadStream(candidate).pipe(res);
      return true;
    }
  }
  return false;
}

export async function startUnifiedServer(port = Number(process.env.PORT) || 3000) {
  let viteMiddleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null = null;

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const { pathname } = url;

    if (req.method === "GET" && (pathname === "/api/health" || pathname === "/health")) {
      const catalog = loadCatalogWithSha256();
      sendJson(res, 200, {
        ok: true,
        mode: process.env.GEMINI_API_KEY ? "llm" : "offline",
        model: process.env.GEMINI_API_KEY ? "gemini-2.5-flash" : "deterministic-grounded-table",
        sha256: catalog.sha256,
        investigations: catalog.investigations.length,
      });
      return;
    }

    if (req.method === "POST" && (pathname === "/api/astroflame-rag" || pathname === "/ask")) {
      const startMs = Date.now();
      const body = await readJsonBody(req);
      const rawQuestion = sanitizeText(body.question ?? body.query ?? "", 400);
      const catalog = loadCatalogWithSha256();
      const result = runGroundedPipelineSync(rawQuestion, catalog.investigations, catalog.publications);

      let finalAnswer = result.answer;
      let llmCalled = false;

      if (result.status === "DIRECT_TABLE" && process.env.GEMINI_API_KEY) {
        const contextText = result.chunks.map((c) => `[${c.ref}] ${c.snippet}`).join("\n");
        const llmText = await synthesizeWithGeminiTimeout(result.question, contextText);
        if (llmText) {
          finalAnswer = llmText;
          llmCalled = true;
        }
      }

      const citations = result.chunks.map((c) => ({
        ref: c.ref,
        kind: "investigation" as const,
        source_id: c.id,
        title: `${c.title} (Relevance ${c.relevancePct}% · ${c.conditionMatch} · ${c.completeness})`,
        url: c.url,
        snippet: c.snippet,
        is_mock: false,
        page: null,
        page_url: c.url,
        evidence: `Chamber O₂: ${c.chamberO2} | Burner O₂: ${c.burnerO2}`,
      }));

      sendJson(res, 200, {
        ...result,
        answer: finalAnswer,
        llmCalled,
        citations,
        warnings: result.gapReport ? [result.gapReport] : [],
        uses_mock_data: false,
        cost_usd: 0,
        latency_ms: Date.now() - startMs,
        verification: {
          checked: result.chunks.length,
          supported: result.chunks.filter((c) => c.conditionMatch !== "UNMATCHED").length,
          weak: result.chunks.filter((c) => c.conditionMatch === "PARTIAL").length,
          unsupported: 0,
        },
        catalogSha256: catalog.sha256,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/proxy-predict") {
      const body = await readJsonBody(req);
      const check = sanitizePredictPayload(body);
      if (!check.ok || !check.data) {
        sendJson(res, 400, { ok: false, error: check.error ?? "Invalid request payload" });
        return;
      }
      const { o2, gravity, pressureAtm, flowCmPerSec, fuel } = check.data;
      const regime = describeFlameRegime(gravity, o2);
      const catalog = loadCatalogWithSha256();
      const matchingIds = catalog.investigations
        .filter((inv) =>
          inv.conditions.o2.some((obs) => obs.basis === "ambient" && o2 >= obs.min_percent && o2 <= obs.max_percent),
        )
        .map((inv) => inv.id);

      sendJson(res, 200, {
        ok: true,
        input: { o2, gravity, pressureAtm, flowCmPerSec, fuel },
        regime,
        matchingInvestigations: matchingIds,
        catalogSha256: catalog.sha256,
      });
      return;
    }

    if (viteMiddleware) {
      viteMiddleware(req, res, () => {
        if (!tryServeStatic(pathname, res)) {
          tryServeStatic("/index.html", res);
        }
      });
      return;
    }

    if (!tryServeStatic(pathname, res)) {
      if (!tryServeStatic("/index.html", res)) {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  });

  if (process.env.VITE_DEV_MIDDLEWARE === "true") {
    import("vite")
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          root: __dirname,
          configFile: path.join(__dirname, "vite.config.ts"),
          server: { middlewareMode: true },
          appType: "spa",
        }),
      )
      .then((vite) => {
        viteMiddleware = vite.middlewares;
      })
      .catch(() => undefined);
  }

  return new Promise<http.Server>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Deep Space Obsidian Unified Server running at http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startUnifiedServer();
}
