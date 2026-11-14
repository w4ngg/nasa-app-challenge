import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { AnswerView } from "../components/AnswerView";
import { askAssistant, assistantUrl, checkHealth, loadSamples } from "../lib/assistant";
import type { AssistantAnswer, Health, SampleFile } from "../lib/assistant";
import { emptyFilters } from "../lib/filters";
import { routeUrl } from "../lib/route";

const EXAMPLES = [
  "Compare BASS and Saffire",
  "Which experiments burned PMMA, and at what oxygen levels?",
  "Why can turning off ventilation help put out a fire in microgravity?",
  "What did FLEX learn about extinguishing fuel droplets?",
];

const recordHref = (psiId: string) =>
  /^PSI-\d+$/.test(psiId) ? routeUrl({ view: "assistant", id: psiId, filters: emptyFilters, page: 0 }) : null;

export function AssistantPage({ onLink }: { onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [health, setHealth] = useState<Health | null | "checking">("checking");
  const [samples, setSamples] = useState<SampleFile | null>(null);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AssistantAnswer[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const connect = () => {
    setHealth("checking");
    checkHealth().then(setHealth);
  };
  useEffect(() => {
    connect();
    loadSamples().then(setSamples);
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setPending(true);
    setError(null);
    const history = thread.flatMap((a) => [{ role: "user", content: a.question }, { role: "assistant", content: a.answer }]);
    try {
      const answer = await askAssistant(q, history);
      setThread((t) => [...t, answer]);
      setQuestion("");
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "The assistant did not answer in time.");
    } finally {
      setPending(false);
      input.current?.focus();
    }
  }

  const live = health !== "checking" && health !== null;

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
          <p className="status-line" role="status">
            Connected to the local assistant at {assistantUrl}.{" "}
            {health.mode === "llm" ? `Answers are written by ${health.model ?? "the language model"} from the retrieved sources.` : "No API key is set, so it runs in offline mode: it shows the best-matching source passages without writing an answer."}
          </p>
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
          <h2 id="ask-title">Ask a question</h2>
          <form onSubmit={submit} className="ask-form">
            <label htmlFor="question" className="sr-only">Your question</label>
            <textarea id="question" ref={input} rows={3} value={question} placeholder="For example: Which experiments burned PMMA, and at what oxygen levels?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
            <div className="ask-actions">
              <button type="submit" className="primary" disabled={pending || !question.trim()}>{pending ? "Searching the sources…" : "Ask"}</button>
              <span className="field-help">Enter to send, Shift+Enter for a new line.</span>
            </div>
          </form>
          <div className="examples" role="group" aria-label="Example questions">
            {EXAMPLES.map((q) => <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}</button>)}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      )}

      {thread.length > 0 && (
        <section className="answers" aria-label="Answers" aria-live="polite">
          {[...thread].reverse().map((a, i) => <AnswerView key={thread.length - i} id={`live-${thread.length - i}`} answer={a} recordHref={recordHref} onLink={onLink} />)}
        </section>
      )}

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
