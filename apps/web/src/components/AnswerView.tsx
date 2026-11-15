import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { getTrace } from "../lib/assistant";
import type { AssistantAnswer, AssistantCitation, ContextPreview, NavItem, Trace, TraceEvent, Verification } from "../lib/assistant";
import { emptyFilters } from "../lib/filters";
import { routeUrl } from "../lib/route";
import type { View } from "../lib/route";
import { AssistantChart } from "./AssistantChart";

// The assistant answers in light Markdown: paragraphs, "- " bullets, **bold**, pipe tables
// and citation tags like [S1] / [I2] / [R1] / [P1]. Rendered as React elements (never innerHTML).
const TAG = /\[((?:[SIPR]\d+)(?:\]\[[SIPR]\d+)*)\]/g;
type Link = (event: MouseEvent<HTMLAnchorElement>) => void;
type Cite = (ref: string) => void;

function inline(text: string, onCite?: Cite): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) out.push(...bold(text.slice(last, m.index)));
    for (const ref of m[1].split("][")) {
      out.push(
        <button key={`${m.index}-${ref}`} type="button" className="cite" aria-label={`Show source ${ref}`}
          onClick={(e) => { e.stopPropagation(); onCite?.(ref); }}>[{ref}]</button>,
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...bold(text.slice(last)));
  return out;
}

function bold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function Markdown({ text, onCite }: { text: string; onCite?: Cite }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0; // block keys must be unique; line indexes repeat between a list's end and the next paragraph
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="table-scroll answer-table" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j} scope="col">{inline(c, onCite)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, onCite)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) items.push(lines[i++].trim().slice(2));
      blocks.push(<ul key={key++}>{items.map((item, j) => <li key={j}>{inline(item, onCite)}</li>)}</ul>);
      continue;
    }
    blocks.push(<p key={key++}>{inline(line.replace(/^#+\s*/, ""), onCite)}</p>);
    i++;
  }
  return <div className="answer-text">{blocks}</div>;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const level = (x: number | null | undefined) => (x === null || x === undefined ? "" : x >= 0.9 ? "good" : x >= 0.7 ? "fair" : "poor");

export function navHref(n: NavItem): string {
  if (n.url) return n.url;
  const p = n.params ?? {};
  return routeUrl({ view: (n.view ?? "overview") as View, id: p.id ?? null, filters: emptyFilters, page: 0, dataset: p.dataset ?? null });
}

function NavLink({ n, onLink }: { n: NavItem; onLink: Link }) {
  return n.url
    ? <a href={n.url} target="_blank" rel="noreferrer">{n.label} ↗</a>
    : <a href={navHref(n)} onClick={onLink}>{n.label}</a>;
}

/** Left panel: one question and its answer, chart(s) and quick links. */
export function AnswerCard({ answer, selected, onSelect, onCite, onLink }: {
  answer: AssistantAnswer;
  selected: boolean;
  onSelect: () => void;
  onCite: Cite;
  onLink: Link;
}) {
  const v = answer.verification;
  const faith = v?.faithfulness?.score;
  const nav = answer.navigation ?? [];
  return (
    <article className={`answer ${selected ? "answer-selected" : ""}`} onClick={onSelect}>
      <p className="answer-q"><span>Question</span> {answer.question}</p>
      {answer.refused && <p className="answer-flag">Not enough evidence in the NASA sources to answer fully.</p>}
      <Markdown text={answer.answer} onCite={onCite} />
      {(answer.charts ?? []).map((c, i) => <AssistantChart key={`${c.kind}-${i}`} spec={c} />)}
      {nav.length > 0 && (
        <div className="answer-nav">
          <span>Explore on the site:</span>
          {nav.slice(0, 2).map((n) => <NavLink key={n.label} n={n} onLink={onLink} />)}
        </div>
      )}
      <div className="answer-foot">
        <ul className="answer-chips" aria-label="Answer details">
          {answer.mode && <li>{answer.mode === "llm" ? "Written by DeepSeek" : "Offline: source passages"}</li>}
          {v?.claims ? <li className={level(faith)} title="Claims found in the retrieved NASA passages">Grounded {pct(faith)}</li> : null}
          {v?.claims ? <li className={level(v.citation_correctness)} title="Claims supported by the source they cite">Citations {pct(v.citation_correctness)}</li> : null}
          {answer.citations.length > 0 && <li>{answer.citations.length} sources</li>}
        </ul>
        <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
          {selected ? "Shown in the side panel" : "Show sources and checks"}
        </button>
      </div>
    </article>
  );
}

// ---------- side panel ----------

const WORD = /[a-z0-9.]+/g;
function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 3));
}

/** Split a passage into sentences and flag the ones the answer drew on (word overlap with the citing sentences). */
function markPassage(passage: string, claims: string[]): { text: string; used: boolean }[] {
  const parts = passage.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const claimWords = claims.map(words).filter((w) => w.size > 2);
  return parts.map((text) => {
    const w = words(text);
    const used = claimWords.some((c) => {
      let hit = 0;
      c.forEach((x) => { if (w.has(x)) hit++; });
      return hit / c.size >= 0.35 && hit >= 3;
    });
    return { text, used };
  });
}

function splitEvidence(c: AssistantCitation): { section: string; body: string } {
  const ev = c.evidence || c.snippet || "";
  if (c.kind === "document") {
    const lines = ev.split("\n");
    if (lines.length > 2 && lines[0].trim() === c.title.trim()) return { section: lines[1], body: lines.slice(2).join("\n") };
  }
  return { section: "", body: ev };
}

function SourceCard({ c, claims, focused, recordHref, onLink }: {
  c: AssistantCitation;
  claims: string[];
  focused: boolean;
  recordHref: (psiId: string) => string | null;
  onLink: Link;
}) {
  const { section, body } = splitEvidence(c);
  const internal = /^PSI-\d+$/.test(c.source_id) ? recordHref(c.source_id) : null;
  const external = c.page_url || c.url;
  const isDoc = c.kind === "document";
  const parts = isDoc ? markPassage(body, claims) : [];
  return (
    <li id={`side-src-${c.ref}`} className={`source-card ${focused ? "focused" : ""}`}>
      <p className="source-head"><span className="cite-ref">[{c.ref}]</span> <span className="cite-title">{c.title}</span></p>
      <p className="source-meta">
        {c.kind === "document" ? "Document" : c.kind === "investigation" ? "NASA PSI record" : c.kind === "prediction" ? "Model estimate (Module 5)" : c.kind === "scenario" ? "Challenge statement" : c.kind}
        {c.page ? ` · PDF page ${c.page}` : ""}{section && !/^p\. \d+$/.test(section.trim()) ? ` · ${section}` : ""}
      </p>
      {isDoc ? (
        <blockquote className="source-passage" aria-label={`Passage quoted from ${c.title}`}>
          {parts.map((p, i) => (p.used ? <mark key={i}>{p.text} </mark> : <span key={i}>{p.text} </span>))}
        </blockquote>
      ) : (
        <pre className="source-record">{body}</pre>
      )}
      {isDoc && parts.some((p) => p.used) && <p className="source-legend"><mark>Highlighted</mark> sentences are the ones the answer drew on.</p>}
      <p className="cite-links">
        {external && <a href={external} target="_blank" rel="noreferrer">{c.page ? `Open the PDF at page ${c.page} ↗` : "Open the source ↗"}</a>}
        {internal && <a href={internal} onClick={onLink}>Open {c.source_id} in the experiment library</a>}
      </p>
    </li>
  );
}

const STATUS_LABEL: Record<string, string> = { supported: "Supported", weak: "Partly", unsupported: "Not found", uncited: "No source tag" };

function FactCheck({ answer, onCite }: { answer: AssistantAnswer; onCite: Cite }) {
  const v: Verification | undefined = answer.verification;
  if (!v?.sentences?.length) return <p className="field-help">No automatic check for this answer.</p>;
  const rows = v.sentences.filter((s) => s.refs.length || s.context_status !== "supported");
  return (
    <div className="fact-check">
      <ul className="answer-chips">
        <li className={level(v.faithfulness?.score)}>Grounded in the retrieved passages: {pct(v.faithfulness?.score)}</li>
        <li className={level(v.citation_correctness)}>Supported by the cited source: {pct(v.citation_correctness)}</li>
      </ul>
      <p className="field-help">An automatic word-overlap check of each sentence against its source. A flagged sentence needs a human look; it is not automatically wrong.</p>
      {answer.warnings.length > 0 && <ul className="answer-warnings">{answer.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <ol className="check-list">
        {rows.map((s, i) => (
          <li key={i} className={`check-${s.status}`}>
            <p>{s.text.length > 240 ? `${s.text.slice(0, 237)}…` : s.text}</p>
            <p className="check-meta">
              <span className={`check-badge ${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
              {s.refs.map((r) => <button key={r} type="button" className="cite" onClick={() => onCite(r)}>[{r}]</button>)}
              {s.miscited && s.suggested_refs?.length ? <span>Better source: {s.suggested_refs.map((r) => `[${r}]`).join(" ")}</span> : null}
              {s.inference?.length ? <span>Interpretation wording: “{s.inference.join("”, “")}”</span> : null}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function traceLine(e: TraceEvent): string {
  const s = (k: string) => (e[k] === undefined || e[k] === null ? "" : String(e[k]));
  switch (e.kind) {
    case "retrieval": {
      const hits = (e.hits as { tag: string; chunk: string }[] | undefined) ?? [];
      return `Searched the documents (${s("retriever") || "bm25"}): “${s("query")}” → ${hits.map((h) => h.tag).join(" ") || "nothing relevant"}`;
    }
    case "llm_call":
      return `Language model (${s("purpose")}): ${s("latency_ms")} ms, ${s("prompt_tokens")} in / ${s("completion_tokens")} out tokens, $${Number(e.cost_usd ?? 0).toFixed(5)}`;
    case "tool_call":
      return `Tool ${s("name")}${e.n_results !== undefined ? ` → ${s("n_results")} results` : ""}${e.error ? ` (error: ${s("error")})` : ""}`;
    case "compression":
      return `Conversation memory: ${s("history_in")} messages, ${s("summarized")} summarized`;
    case "guardrail":
      return `Citation guardrail: kept ${((e.cited as string[]) ?? []).join(" ") || "none"}${((e.removed_invalid_tags as string[]) ?? []).length ? `; removed ${(e.removed_invalid_tags as string[]).join(" ")}` : ""}`;
    case "verification":
      return `Fact check: grounded ${pct((e.faithfulness as { score?: number })?.score)}, citations ${pct(e.citation_correctness as number)}`;
    default:
      return e.kind.replace(/_/g, " ");
  }
}

function Details({ answer, live }: { answer: AssistantAnswer; live: boolean }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setTrace(null); setError(null); }, [answer.trace_id]);
  return (
    <div className="details-tab">
      <dl className="details-grid">
        <dt>Answered by</dt><dd>{answer.mode === "llm" ? "DeepSeek, from the retrieved NASA passages" : "Offline mode: best-matching passages, no generated text"}</dd>
        {answer.latency_ms ? <><dt>Time</dt><dd>{(answer.latency_ms / 1000).toFixed(1)} s{answer.first_word_ms ? ` (first words after ${(answer.first_word_ms / 1000).toFixed(1)} s)` : ""}</dd></> : null}
        {answer.prompt_tokens ? <><dt>Tokens</dt><dd>{answer.prompt_tokens.toLocaleString()} in / {(answer.completion_tokens ?? 0).toLocaleString()} out</dd></> : null}
        <dt>Cost</dt><dd>${(answer.cost_usd ?? 0).toFixed(4)}</dd>
      </dl>
      {live && answer.trace_id && (
        <details className="answer-trace" onToggle={(event) => {
          if ((event.target as HTMLDetailsElement).open && !trace) getTrace(answer.trace_id!).then(setTrace).catch((e: Error) => setError(e.message));
        }}>
          <summary>Steps the assistant took</summary>
          {error && <p className="field-error">{error}</p>}
          {!trace && !error && <p className="field-help">Loading…</p>}
          {trace && <ol className="trace-list">{trace.events.map((e, i) => <li key={i}><span className="trace-t">{e.t_ms} ms</span> {traceLine(e)}</li>)}</ol>}
        </details>
      )}
    </div>
  );
}

export function ContextView({ p }: { p: ContextPreview }) {
  const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 4 : 3)}`;
  return (
    <div className="context-view">
      <p className="field-help">Free check: nothing was sent to the language model.</p>
      <h3>Passages the assistant would read first</h3>
      {p.prefetch_hits.length ? (
        <ol className="context-hits">{p.prefetch_hits.map((h) => <li key={h.tag}><strong>{h.tag}</strong> {h.source_id}</li>)}</ol>
      ) : <p className="field-help">No passage passed the relevance threshold, so the assistant would likely say the sources do not cover this.</p>}
      <h3>Estimated cost with DeepSeek</h3>
      <table className="context-table">
        <tbody>{p.scenarios.map((s) => <tr key={s.scenario}><td>{s.scenario === "direct" ? "Answers right away" : s.scenario === "typical" ? "One extra search (typical)" : "Maximum searches"}</td><td className="num">{usd(s.cost_usd)}</td></tr>)}</tbody>
      </table>
      <p className="field-help">About {p.first_call_input_tokens.toLocaleString()} tokens in the first request.{p.budget ? ` Budget used: ${usd(p.budget.spent_usd)} of ${usd(p.budget.limit_usd)}.` : ""}</p>
    </div>
  );
}

export type SideTab = "sources" | "check" | "explore" | "details";

/** Right panel: sources with quoted passages, fact check, links into the site, details. */
export function AnswerSidePanel({ answer, tab, setTab, focusRef, onCite, recordHref, onLink, live, preview }: {
  answer: AssistantAnswer | null;
  tab: SideTab;
  setTab: (t: SideTab) => void;
  focusRef: string | null;
  onCite: Cite;
  recordHref: (psiId: string) => string | null;
  onLink: Link;
  live: boolean;
  preview: ContextPreview | null;
}) {
  useEffect(() => {
    if (focusRef && tab === "sources") document.getElementById(`side-src-${focusRef}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusRef, tab, answer]);
  const tabs: [SideTab, string][] = [["sources", `Sources${answer ? ` (${answer.citations.length})` : ""}`], ["check", "Fact check"],
    ["explore", `Explore on site${answer?.navigation?.length ? ` (${answer.navigation.length})` : ""}`], ["details", "Details"]];
  const claimsFor = (ref: string) => (answer?.verification?.sentences ?? []).filter((s) => s.refs.includes(ref)).map((s) => s.text);
  return (
    <aside className="assistant-side panel" aria-label="Sources and checks">
      <div className="side-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="side-body" role="tabpanel">
        {preview && tab === "details" && <ContextView p={preview} />}
        {!answer ? (
          !(preview && tab === "details") && <p className="field-help side-empty">Ask a question. Its sources, with the exact passages from the NASA documents, appear here.</p>
        ) : (
          <>
            <p className="side-q">{answer.question}</p>
            {tab === "sources" && (answer.citations.length ? (
              <ol className="source-list">
                {answer.citations.map((c) => <SourceCard key={c.ref} c={c} claims={claimsFor(c.ref)} focused={focusRef === c.ref} recordHref={recordHref} onLink={onLink} />)}
              </ol>
            ) : <p className="field-help">This answer has no sources.</p>)}
            {tab === "check" && <FactCheck answer={answer} onCite={onCite} />}
            {tab === "explore" && (answer.navigation?.length ? (
              <ul className="explore-list">
                {answer.navigation.map((n) => <li key={n.label}><NavLink n={n} onLink={onLink} />{n.reason && <p className="field-help">{n.reason}</p>}</li>)}
              </ul>
            ) : <p className="field-help">No other part of the site matches this answer.</p>)}
            {tab === "details" && <Details answer={answer} live={live} />}
          </>
        )}
      </div>
    </aside>
  );
}
