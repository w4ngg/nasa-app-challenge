// Client for the research assistant API in apps/assistant (FastAPI, `uvicorn assistant.api:app --port 8003`).
// It runs on the team's machine; the static site falls back to saved sample answers.
// The DeepSeek API key stays on that server (apps/assistant/.env) and is never sent to the browser.
export const assistantUrl = (import.meta.env.VITE_ASSISTANT_URL || "http://127.0.0.1:8003").replace(/\/$/, "");

export type AskMode = "offline" | "llm";

export interface AssistantCitation {
  ref: string;
  kind: string; // "document" | "investigation" | "prediction" | "scenario"
  source_id: string;
  title: string;
  url: string;
  snippet: string;
  is_mock: boolean;
  page: number | null;
  page_url: string;
  evidence: string;
}

export interface VerifiedSentence {
  text: string;
  refs: string[];
  status: "supported" | "weak" | "unsupported" | "uncited";
  context_status?: "supported" | "weak" | "unsupported";
  miscited?: boolean;
  suggested_refs?: string[];
  inference?: string[];
  missing_numbers?: string[];
  missing_terms?: string[];
}

export interface Verification {
  checked?: number;
  supported?: number;
  weak?: number;
  unsupported?: number;
  uncited?: number;
  claims?: number;
  miscited?: number;
  inference?: number;
  citation_correctness?: number | null;
  faithfulness?: { supported?: number; weak?: number; unsupported?: number; score?: number | null };
  sentences?: VerifiedSentence[];
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
  verification?: Verification;
  trace_id?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  tool_calls?: { name: string; args?: unknown; n_results?: number }[];
  suggested_sources?: AssistantCitation[];
  // set by the page, not the API
  mode?: AskMode;
  first_word_ms?: number;
}

export interface Health {
  ok: boolean;
  mode: AskMode;
  model: string | null;
  llm_available?: boolean;
  llm_model?: string | null;
  budget?: { spent_usd: number; limit_usd: number };
  retriever?: string;
}

export interface CostScenario { scenario: string; tool_rounds: number; llm_calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

export interface ContextPreview {
  question: string;
  model: string;
  estimation: string;
  parts: { part: string; chars: number; tokens: number }[];
  first_call_input_tokens: number;
  history: { history_in: number; kept: number; summarized: number; method: string };
  prefetch_hits: { tag: string; source_id: string; score: number }[];
  scenarios: CostScenario[];
  budget?: { spent_usd: number; limit_usd: number; remaining_usd: number; questions_left_typical?: number };
}

export interface TraceEvent { kind: string; t_ms: number; [key: string]: unknown }
export interface Trace { trace_id: string; mode: string; question: string; events: TraceEvent[]; totals?: Record<string, number> }

export type StreamEvent = { type: "status"; text: string } | { type: "delta"; text: string } | { type: "reset" };

export interface SampleFile {
  generated_at: string;
  mode: string;
  model: string | null;
  answers: AssistantAnswer[];
}

type Turn = { role: string; content: string };

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

async function errorText(response: Response): Promise<string> {
  if (response.status === 402) return "The assistant's spending limit is reached; switch to offline mode.";
  try {
    const body = await response.json() as { detail?: string };
    if (body.detail) return body.detail;
  } catch { /* not JSON */ }
  return `The assistant returned an error (HTTP ${response.status}).`;
}

export async function checkHealth(): Promise<Health | null> {
  try {
    return await withTimeout(2500, async (signal) => {
      const response = await fetch(`${assistantUrl}/health`, { signal });
      if (!response.ok) return null;
      const body = await response.json() as Partial<Health>;
      return { ...body, ok: true, mode: body.mode === "llm" ? "llm" : "offline", model: body.model ?? null } as Health;
    });
  } catch {
    return null;
  }
}

export async function askAssistant(question: string, history: Turn[], mode?: AskMode, confirmPaid = false): Promise<AssistantAnswer> {
  return withTimeout(120000, async (signal) => {
    const response = await fetch(`${assistantUrl}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history, mode, confirm_paid: confirmPaid }),
      signal,
    });
    if (!response.ok) throw new Error(await errorText(response));
    return response.json() as Promise<AssistantAnswer>;
  });
}

/** Streams an answer (Server-Sent Events): status lines and text deltas, then the verified final answer. */
export async function askAssistantStream(question: string, history: Turn[], mode: AskMode, confirmPaid: boolean,
  onEvent: (event: StreamEvent) => void): Promise<AssistantAnswer> {
  return withTimeout(180000, async (signal) => {
    const response = await fetch(`${assistantUrl}/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history, mode, confirm_paid: confirmPaid }),
      signal,
    });
    if (!response.ok || !response.body) throw new Error(await errorText(response));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: AssistantAnswer | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 2);
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5)) as { type: string; text?: string; answer?: AssistantAnswer; error?: string; status?: number };
        if (event.type === "done" && event.answer) final = event.answer;
        else if (event.type === "error") throw new Error(event.status === 402 ? "The assistant's spending limit is reached; switch to offline mode." : event.error);
        else if (event.type === "status" || event.type === "delta") onEvent({ type: event.type, text: event.text ?? "" });
        else if (event.type === "reset") onEvent({ type: "reset" });
      }
    }
    if (!final) throw new Error("The answer stream ended early.");
    return final;
  });
}

/** Context and cost the question would use, without calling the language model (free). */
export async function previewContext(question: string, history: Turn[]): Promise<ContextPreview> {
  return withTimeout(30000, async (signal) => {
    const response = await fetch(`${assistantUrl}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
      signal,
    });
    if (!response.ok) throw new Error(await errorText(response));
    return response.json() as Promise<ContextPreview>;
  });
}

export async function getTrace(traceId: string): Promise<Trace> {
  return withTimeout(10000, async (signal) => {
    const response = await fetch(`${assistantUrl}/trace/${encodeURIComponent(traceId)}`, { signal });
    if (!response.ok) throw new Error(await errorText(response));
    return response.json() as Promise<Trace>;
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
