import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { AnswerCard, AnswerSidePanel, Markdown } from "../components/AnswerView";
import type { SideTab } from "../components/AnswerView";
import { ResizableSplit } from "../components/Resizable";
import { askAssistantStream, assistantUrl, checkHealth, loadSamples, previewContext } from "../lib/assistant";
import type { AskMode, AssistantAnswer, ContextPreview, Health, SampleFile } from "../lib/assistant";
import { emptyFilters } from "../lib/filters";
import { routeUrl } from "../lib/route";

// Example questions, grouped so a presenter can pick one per kind. "Numbers" questions draw a chart
// computed from the NASA experiment tables; "Everyday words" need no science background.
const EXAMPLES: { group: string; questions: string[] }[] = [
  { group: "Numbers & charts", questions: [
    "Which experiments tested oxygen levels as high as the 30% planned for a Moon base?",
    "In the FLEX experiment, did fuel droplets burn longer when there was more oxygen?",
  ] },
  { group: "Everyday words", questions: [
    "Does fire behave differently in space than on Earth?",
    "Why do flames look like round balls in space?",
    "What happened during the fire on the Mir space station?",
  ] },
  { group: "Research", questions: [
    "Compare BASS and Saffire",
    "Rank the investigations most relevant to fire prevention in a Moon base",
    "Estimate how long a heptane droplet burns at 25% oxygen",
  ] },
];

const recordHref = (psiId: string) =>
  /^PSI-\d+$/.test(psiId) ? routeUrl({ view: "explorer", id: psiId, filters: emptyFilters, page: 0 }) : null;

const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 4 : 3)}`;

export function AssistantPage({ onLink }: { onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [health, setHealth] = useState<Health | null | "checking">("checking");
  const [samples, setSamples] = useState<SampleFile | null>(null);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AssistantAnswer[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [tab, setTab] = useState<SideTab>("sources");
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AskMode>("offline");
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState<string[]>([]);
  const [liveQuestion, setLiveQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const connect = () => {
    setHealth("checking");
    checkHealth().then(setHealth);
  };
  useEffect(() => {
    connect();
    loadSamples().then(setSamples);
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [thread.length, liveText, pending]);

  const history = () => thread.flatMap((a) => [{ role: "user", content: a.question }, { role: "assistant", content: a.answer }]);

  const apiUp = health !== "checking" && health !== null && health.model !== "client-grounded-pipeline";
  const llmReady = apiUp && Boolean((health as Health).llm_available ?? (health as Health).mode === "llm");
  const budget = apiUp ? (health as Health).budget : undefined;
  const shown: AssistantAnswer[] = thread.length ? thread : (!apiUp && samples ? samples.answers : []);
  const current = selected >= 0 && selected < shown.length ? shown[selected] : null;

  function cite(index: number, ref: string) {
    setSelected(index);
    setTab("sources");
    setFocusRef(ref);
  }

  async function checkContext() {
    const q = question.trim();
    if (!q || checking) return;
    setChecking(true);
    setError(null);
    try {
      setPreview(await previewContext(q, history()));
      setTab("details");
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
      } catch { /* the estimate is optional */ }
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
      setThread((t) => {
        const next = [...t, { ...answer, mode, first_word_ms: firstWord ? Math.round(firstWord) : undefined }];
        setSelected(next.length - 1);
        return next;
      });
      setTab("sources");
      setFocusRef(null);
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

  return (
    <div className="page assistant-page">
      <header className="page-header">
        <h1>Research assistant</h1>
        <p>
          Ask about NASA's microgravity combustion experiments in plain words. Answers come only from NASA PSI records,
          NTRS reports and the challenge resources; the side panel shows the exact passage behind every source tag.
        </p>
      </header>

      <ResizableSplit
        className="assistant-split"
        ariaLabel="Resize Ask and Sources panels"
        mode="ratio"
        defaultSize={0.535}
        leftMin={300}
        rightMin={280}
        resizableHeight
        minHeight={360}
        maxHeight={1400}
        storageKey="fa-resize-assistant"
        left={
          <section className="assistant-chat panel" aria-labelledby="ask-title">
          <div className="assistant-chat-head">
            <h2 id="ask-title">Ask</h2>
            <div className="segmented" role="group" aria-label="Answer mode">
              <button type="button" aria-pressed={mode === "offline"} onClick={() => setMode("offline")}>Offline (free)</button>
              <button type="button" aria-pressed={mode === "llm"} disabled={!llmReady}
                title={llmReady ? "Answers written by DeepSeek; asks before each paid call" : "Needs the assistant API with DEEPSEEK_API_KEY in apps/assistant/.env"}
                onClick={() => setMode("llm")}>DeepSeek (paid)</button>
            </div>
            {thread.length > 0 && <button type="button" className="link-button" onClick={() => { setThread([]); setSelected(-1); setPreview(null); }}>New conversation</button>}
          </div>
          <p className="status-line small" role="status">
            {health === "checking" ? `Looking for the assistant at ${assistantUrl}…`
              : apiUp ? `Connected${(health as Health).retriever === "hybrid" ? " · search by keywords and meaning" : ""}${llmReady && budget ? ` · paid quota used ${usd(budget.spent_usd)} of ${usd(budget.limit_usd)}` : ""}`
                : "The live assistant is not running, so answers come from a simpler in-browser search. Start it with: cd apps/assistant && uvicorn assistant.api:app --port 8003"}
            {!apiUp && health !== "checking" && <button type="button" className="link-button" onClick={connect}>Retry</button>}
          </p>

          <div className="assistant-thread" aria-live="polite">
            {!shown.length && !pending && (
              <div className="assistant-examples">
                {EXAMPLES.map((g) => (
                  <div key={g.group} className="examples" role="group" aria-label={g.group}>
                    <span className="examples-label">{g.group}</span>
                    {g.questions.map((q) => <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}</button>)}
                  </div>
                ))}
              </div>
            )}
            {!thread.length && shown.length > 0 && <p className="field-help">Saved example answers{samples?.mode === "llm" ? ` written by ${samples.model}` : ""}.</p>}
            {shown.map((a, i) => (
              <AnswerCard key={i} answer={a} selected={i === selected} onSelect={() => setSelected(i)} onCite={(r) => cite(i, r)} onLink={onLink} />
            ))}
            {pending && liveQuestion && (
              <article className="answer answer-live" aria-busy="true">
                <p className="answer-q"><span>Question</span> {liveQuestion}</p>
                {liveStatus.length > 0 && <ul className="live-status">{liveStatus.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                {liveText ? <Markdown text={liveText} /> : <p className="field-help">Searching the NASA sources…</p>}
              </article>
            )}
            <div ref={bottom} />
          </div>

          <form onSubmit={submit} className="ask-form">
            <label htmlFor="question" className="sr-only">Your question</label>
            <textarea id="question" ref={input} rows={2} value={question} placeholder="Ask anything, e.g. Why do flames look like round balls in space?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
            <div className="ask-actions">
              <button type="submit" className="primary" disabled={pending || !question.trim()}>{pending ? "Answering…" : mode === "llm" ? "Ask DeepSeek" : "Ask"}</button>
              {apiUp && (
                <button type="button" onClick={checkContext} disabled={checking || pending || !question.trim()} title="Free: no language model call">
                  {checking ? "Checking…" : "Check context & cost"}
                </button>
              )}
              {thread.length > 0 && (
                <details className="more-examples">
                  <summary>Examples</summary>
                  <div className="examples">{EXAMPLES.flatMap((g) => g.questions).map((q) => <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}>{q}</button>)}</div>
                </details>
              )}
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
          </form>
          </section>
        }
        right={
          <AnswerSidePanel answer={current} tab={tab} setTab={setTab} focusRef={focusRef} onCite={(r) => current && cite(selected, r)}
            recordHref={recordHref} onLink={onLink} live={apiUp} preview={preview} />
        }
      />
    </div>
  );
}
