import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { AnswerView, Markdown } from "../components/AnswerView";
import { askAssistantStream, assistantUrl, checkHealth, loadSamples, previewContext } from "../lib/assistant";
import type { AskMode, AssistantAnswer, ContextPreview, Health, SampleFile } from "../lib/assistant";
import { emptyFilters } from "../lib/filters";
import { routeUrl } from "../lib/route";

const EXAMPLES = [
  "Compare BASS and Saffire",
  "Which experiments burned PMMA, and at what oxygen levels?",
  "Why can turning off ventilation help put out a fire in microgravity?",
  "What did FLEX learn about extinguishing fuel droplets?",
  "Rank the investigations most relevant to fire prevention in a Moon base",
  "What hardware and materials were involved in the 1997 fire aboard Mir?",
];

const recordHref = (psiId: string) =>
  /^PSI-\d+$/.test(psiId) ? routeUrl({ view: "assistant", id: psiId, filters: emptyFilters, page: 0 }) : null;

const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 4 : 3)}`;

function ContextPanel({ p, onClose }: { p: ContextPreview; onClose: () => void }) {
  const typical = p.scenarios.find((s) => s.scenario === "typical");
  return (
    <section className="panel context-panel" aria-labelledby="context-title">
      <div className="panel-head">
        <h2 id="context-title">Context and cost for this question</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="field-help">Nothing was sent to the language model. This is what it would receive first, and what the answer would likely cost.</p>
      <div className="context-grid">
        <div>
          <h3>Passages found first</h3>
          {p.prefetch_hits.length ? (
            <ol className="context-hits">{p.prefetch_hits.map((h) => <li key={h.tag}><strong>{h.tag}</strong> {h.source_id} <span className="muted">score {h.score}</span></li>)}</ol>
          ) : <p className="field-help">No passage passed the relevance threshold: the assistant would likely say the sources do not cover this.</p>}
          <h3>Conversation memory</h3>
          <p className="field-help">{p.history.history_in} earlier messages: {p.history.kept} kept word for word, {p.history.summarized} summarized ({p.history.method}).</p>
        </div>
        <div>
          <h3>First request: about {p.first_call_input_tokens.toLocaleString()} tokens</h3>
          <table className="context-table">
            <tbody>{p.parts.map((x) => <tr key={x.part}><td>{x.part.replace(/_/g, " ")}</td><td className="num">{x.tokens.toLocaleString()}</td></tr>)}</tbody>
          </table>
          <h3>Estimated cost ({p.model})</h3>
          <table className="context-table">
            <thead><tr><th scope="col">Case</th><th scope="col" className="num">Model calls</th><th scope="col" className="num">Cost</th></tr></thead>
            <tbody>{p.scenarios.map((s) => <tr key={s.scenario}><td>{s.scenario === "direct" ? "Answers right away" : s.scenario === "typical" ? "One extra search (typical)" : "Maximum searches"}</td><td className="num">{s.llm_calls}</td><td className="num">{usd(s.cost_usd)}</td></tr>)}</tbody>
          </table>
          {p.budget && (
            <p className="field-help">Budget: {usd(p.budget.spent_usd)} spent of {usd(p.budget.limit_usd)}{typical ? `; about ${p.budget.questions_left_typical ?? "–"} typical questions left` : ""}.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function AssistantPage({ onLink }: { onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [health, setHealth] = useState<Health | null | "checking">("checking");
  const [samples, setSamples] = useState<SampleFile | null>(null);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AssistantAnswer[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AskMode>("offline");
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState<string[]>([]);
  const [liveQuestion, setLiveQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const connect = () => {
    setHealth("checking");
    checkHealth().then(setHealth);
  };
  useEffect(() => {
    connect();
    loadSamples().then(setSamples);
  }, []);

  const history = () => thread.flatMap((a) => [{ role: "user", content: a.question }, { role: "assistant", content: a.answer }]);

  async function checkContext() {
    const q = question.trim();
    if (!q || checking) return;
    setChecking(true);
    setError(null);
    try {
      setPreview(await previewContext(q, history()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check the context.");
    } finally {
      setChecking(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    if (mode === "llm") {
      let estimate = "";
      try {
        const p = await previewContext(q, history());
        const s = Object.fromEntries(p.scenarios.map((x) => [x.scenario, x.cost_usd]));
        estimate = `\nEstimated cost: about ${usd(s.typical ?? 0)} (from ${usd(s.direct ?? 0)} to ${usd(s.worst ?? 0)}).`;
      } catch { /* estimate is optional */ }
      if (!window.confirm(`This question will be answered by DeepSeek and uses the team's paid quota.${estimate}\nContinue?`)) return;
    }
    setPending(true);
    setLiveQuestion(q);
    setLiveText("");
    setLiveStatus([]);
    const started = performance.now();
    let firstWord: number | undefined;
    try {
      const answer = await askAssistantStream(q, history(), mode, mode === "llm", (e) => {
        if (e.type === "status") setLiveStatus((s) => [...s, e.text]);
        else if (e.type === "delta") {
          if (firstWord === undefined) firstWord = performance.now() - started;
          setLiveText((t) => t + e.text);
        } else setLiveText("");
      });
      setThread((t) => [...t, { ...answer, mode, first_word_ms: firstWord ? Math.round(firstWord) : undefined }]);
      setQuestion("");
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "The assistant did not answer in time.");
    } finally {
      setPending(false);
      setLiveQuestion("");
      checkHealth().then((h) => h && setHealth(h));
      input.current?.focus();
    }
  }

  const live = health !== "checking" && health !== null;
  const llmReady = live && Boolean(health.llm_available ?? health.mode === "llm");
  const budget = live ? health.budget : undefined;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Research assistant</h1>
        <p>
          Ask about NASA's microgravity combustion experiments. Answers come only from NASA PSI records, NTRS reports and the
          challenge resources, and every sentence carries a source tag you can open.
        </p>
      </header>

      <section className="panel" aria-labelledby="status-title">
        <h2 id="status-title" className="sr-only">Connection</h2>
        {health === "checking" && <p role="status">Looking for the assistant at {assistantUrl}…</p>}
        {live && (
          <div className="status-line" role="status">
            <p>
              Connected to the assistant at {assistantUrl}
              {health.retriever ? ` (search: ${health.retriever === "hybrid" ? "keywords + meaning" : health.retriever})` : ""}.{" "}
              {llmReady ? `DeepSeek (${health.llm_model ?? health.model ?? "language model"}) is available for written answers.` : "No API key is set on the server, so only offline mode is available: it shows the best-matching source passages without writing an answer."}
            </p>
            {budget && llmReady && <p className="field-help">Paid quota used: {usd(budget.spent_usd)} of {usd(budget.limit_usd)}. The server stops paid answers at the limit.</p>}
          </div>
        )}
        {health === null && (
          <div className="status-off">
            <p><strong>The live assistant runs on the team's machine, not on this static site.</strong> Saved answers are shown below.</p>
            <p>To ask your own questions, start it from the repository root, then retry:</p>
            <pre><code>cd apps/assistant{"\n"}pip install -r requirements.txt{"\n"}uvicorn assistant.api:app --port 8003</code></pre>
            <button type="button" onClick={connect}>Retry connection</button>
          </div>
        )}
      </section>

      {live && (
        <section className="panel" aria-labelledby="ask-title">
          <div className="panel-head ask-head">
            <h2 id="ask-title">Ask a question</h2>
            <div className="segmented" role="group" aria-label="Answer mode">
              <button type="button" aria-pressed={mode === "offline"} onClick={() => setMode("offline")}>Offline (free)</button>
              <button type="button" aria-pressed={mode === "llm"} disabled={!llmReady} title={llmReady ? "Answers written by DeepSeek; asks before each paid call" : "Set DEEPSEEK_API_KEY in apps/assistant/.env"} onClick={() => setMode("llm")}>DeepSeek (paid)</button>
            </div>
            {thread.length > 0 && <button type="button" onClick={() => { setThread([]); setPreview(null); }}>New conversation</button>}
          </div>
          <form onSubmit={submit} className="ask-form">
            <label htmlFor="question" className="sr-only">Your question</label>
            <textarea id="question" ref={input} rows={3} value={question} placeholder="For example: Which experiments burned PMMA, and at what oxygen levels?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
            <div className="ask-actions">
              <button type="submit" className="primary" disabled={pending || !question.trim()}>{pending ? "Answering…" : mode === "llm" ? "Ask DeepSeek" : "Ask"}</button>
              <button type="button" onClick={checkContext} disabled={checking || pending || !question.trim()} title="Free: no language model call">
                {checking ? "Checking…" : "Check context & cost"}
              </button>
              <span className="field-help">
                Enter to send, Shift+Enter for a new line.{thread.length ? ` Follow-up questions use the last ${thread.length} answer${thread.length > 1 ? "s" : ""} as context.` : ""}
              </span>
            </div>
          </form>
          <div className="examples" role="group" aria-label="Example questions">
            {EXAMPLES.map((q) => <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}</button>)}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      )}

      {preview && <ContextPanel p={preview} onClose={() => setPreview(null)} />}

      {(pending && liveQuestion) || thread.length > 0 ? (
        <section className="answers" aria-label="Answers" aria-live="polite">
          {pending && liveQuestion && (
            <article className="answer answer-live" aria-busy="true">
              <p className="answer-q"><span>Question</span> {liveQuestion}</p>
              {liveStatus.length > 0 && <ul className="live-status">{liveStatus.map((s, i) => <li key={i}>{s}</li>)}</ul>}
              {liveText ? <Markdown text={liveText} anchor={(ref) => `live-${ref}`} /> : <p className="field-help">Searching the sources…</p>}
            </article>
          )}
          {[...thread].reverse().map((a, i) => <AnswerView key={thread.length - i} id={`live-${thread.length - i}`} answer={a} recordHref={recordHref} onLink={onLink} live />)}
        </section>
      ) : null}

      {health === null && (
        <section aria-labelledby="samples-title" className="answers">
          <h2 id="samples-title" className="section-title">Saved answers</h2>
          {samples && samples.answers.length > 0 ? (
            <>
              <p className="field-help">
                Generated on {new Date(samples.generated_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                {samples.mode === "llm" ? ` by ${samples.model ?? "the language model"}` : " in offline mode (source passages, no generated text)"}.
              </p>
              {samples.answers.map((a, i) => <AnswerView key={i} id={`sample-${i}`} answer={a} recordHref={recordHref} onLink={onLink} />)}
            </>
          ) : <p className="state">No saved answers yet. Run apps/assistant/scripts/export_samples.py to create them.</p>}
        </section>
      )}
    </div>
  );
}
