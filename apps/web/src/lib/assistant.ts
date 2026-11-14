// Client for the research assistant API in apps/assistant (FastAPI, `uvicorn assistant.api:app --port 8003`).
// It runs on the team's machine; the static site falls back to saved sample answers.
export const assistantUrl = (import.meta.env.VITE_ASSISTANT_URL || "http://127.0.0.1:8003").replace(/\/$/, "");

export interface AssistantCitation {
  ref: string;
  kind: "document" | "investigation" | "prediction";
  source_id: string;
  title: string;
  url: string;
  snippet: string;
  is_mock: boolean;
  page: number | null;
  page_url: string;
  evidence: string;
}

export interface AssistantAnswer {
  question: string;
  answer: string;
  citations: AssistantCitation[];
  refused: boolean;
  warnings: string[];
  uses_mock_data: boolean;
  cost_usd: number;
  latency_ms: number;
  verification?: { checked?: number; supported?: number; weak?: number; unsupported?: number };
}

export interface Health { ok: boolean; mode: "llm" | "offline"; model: string | null }

export interface SampleFile {
  generated_at: string;
  mode: string;
  model: string | null;
  answers: AssistantAnswer[];
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkHealth(): Promise<Health | null> {
  try {
    return await withTimeout(2500, async (signal) => {
      const response = await fetch(`${assistantUrl}/health`, { signal });
      if (!response.ok) return null;
      const body = await response.json() as Partial<Health>;
      return { ok: true, mode: body.mode === "llm" ? "llm" : "offline", model: body.model ?? null };
    });
  } catch {
    return null;
  }
}

export async function askAssistant(question: string, history: { role: string; content: string }[]): Promise<AssistantAnswer> {
  return withTimeout(120000, async (signal) => {
    const response = await fetch(`${assistantUrl}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
      signal,
    });
    if (response.status === 402) throw new Error("The assistant's spending limit is reached; it answers in offline mode only.");
    if (!response.ok) throw new Error(`The assistant returned an error (HTTP ${response.status}).`);
    return response.json() as Promise<AssistantAnswer>;
  });
}

export async function loadSamples(): Promise<SampleFile | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/assistant-samples.json`);
    return response.ok ? await response.json() as SampleFile : null;
  } catch {
    return null;
  }
}
