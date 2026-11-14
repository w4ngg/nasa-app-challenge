import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { getTrace } from "../lib/assistant";
import type { AssistantAnswer, AssistantCitation, Trace, TraceEvent, Verification } from "../lib/assistant";

// The assistant answers in light Markdown: paragraphs, "- " bullets, **bold**, pipe tables
// and citation tags like [S1] / [I2] / [R1]. Rendered as React elements (never innerHTML).
const TAG = /\[((?:[SIPR]\d+)(?:\]\[[SIPR]\d+)*)\]/g;

function inline(text: string, anchor: (ref: string) => string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) out.push(...bold(text.slice(last, m.index)));
    for (const ref of m[1].split("][")) {
      out.push(<a key={`${m.index}-${ref}`} className="cite" href={`#${anchor(ref)}`} aria-label={`Source ${ref}`}>[{ref}]</a>);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...bold(text.slice(last)));
  return out;
}

function bold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function Markdown({ text, anchor }: { text: string; anchor: (ref: string) => string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
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
        <div key={i} className="table-scroll answer-table" tabIndex={0} role="region" aria-label="Comparison table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j} scope="col">{inline(c, anchor)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, anchor)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) items.push(lines[i++].trim().slice(2));
      blocks.push(<ul key={i}>{items.map((item, j) => <li key={j}>{inline(item, anchor)}</li>)}</ul>);
      continue;
    }
    blocks.push(<p key={i}>{inline(line.replace(/^#+\s*/, ""), anchor)}</p>);
    i++;
  }
  return <div className="answer-text">{blocks}</div>;
}

function CitationItem({ c, anchorId, recordHref, onLink }: {
  c: AssistantCitation;
  anchorId: string;
  recordHref: (psiId: string) => string | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const internal = c.kind === "investigation" ? recordHref(c.source_id) : null;
  const external = c.page_url || c.url;
  const full = c.evidence && c.evidence.length > (c.snippet?.length ?? 0) + 20 ? c.evidence : "";
  return (
    <li id={anchorId}>
      <span className="cite-ref">[{c.ref}]</span>
      <div>
        <p className="cite-title">{c.title}{c.page ? `, p. ${c.page}` : ""}</p>
        {c.snippet && <p className="cite-snippet">{c.snippet}</p>}
        {full && (
          <details className="cite-evidence">
            <summary>Full passage the answer used</summary>
            <pre>{full}</pre>
          </details>
        )}
        <p className="cite-links">
          {external && <a href={external} target="_blank" rel="noreferrer">{c.page ? `Open the PDF at page ${c.page}` : "Open the source"}</a>}
          {internal && <a href={internal} onClick={onLink}>Open {c.source_id} in the experiment library</a>}
        </p>
      </div>
    </li>
  );
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const level = (x: number | null | undefined) => (x === null || x === undefined ? "" : x >= 0.9 ? "good" : x >= 0.7 ? "fair" : "poor");
const STATUS_LABEL: Record<string, string> = { supported: "Supported", weak: "Weak", unsupported: "Not supported", uncited: "No tag" };

function VerificationDetails({ v, anchor }: { v: Verification; anchor: (ref: string) => string }) {
  const rows = (v.sentences ?? []).filter((s) => s.status !== "uncited" || s.context_status !== "supported");
  return (
    <details className="answer-check">
      <summary>Sentence-by-sentence check ({v.checked ?? 0} cited sentences)</summary>
      <p className="field-help">
        Faithfulness: is the sentence found in any retrieved passage? Citation: does the tagged source itself support it?
        These are automatic word-overlap checks, so a flagged sentence needs a human look, not automatic rejection.
      </p>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Sentence</th><th scope="col">Tags</th><th scope="col">Citation</th><th scope="col">In retrieved text</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={i} className={`check-${s.status}`}>
                <td>{s.text.length > 220 ? `${s.text.slice(0, 217)}…` : s.text}</td>
                <td>{s.refs.map((r) => <a key={r} className="cite" href={`#${anchor(r)}`}>[{r}]</a>)}</td>
                <td>{STATUS_LABEL[s.status] ?? s.status}</td>
                <td>{s.context_status ? STATUS_LABEL[s.context_status] : "–"}</td>
                <td>
                  {s.miscited && s.suggested_refs?.length ? `Better source: ${s.suggested_refs.map((r) => `[${r}]`).join(" ")}. ` : ""}
                  {s.inference?.length ? `Inference wording: “${s.inference.join("”, “")}”. ` : ""}
                  {s.missing_numbers?.length ? `Numbers not in source: ${s.missing_numbers.join(", ")}. ` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function traceLine(e: TraceEvent): string {
  const s = (k: string) => (e[k] === undefined || e[k] === null ? "" : String(e[k]));
  switch (e.kind) {
    case "retrieval": {
      const hits = (e.hits as { tag: string; chunk: string; score: number }[] | undefined) ?? [];
      return `Retrieval (${s("origin")}, ${s("retriever") || "bm25"}): “${s("query")}” → ${hits.map((h) => `${h.tag} ${h.chunk}`).join(", ") || "no passages above the threshold"}`;
    }
    case "llm_call":
      return `Language model call (${s("purpose")} #${s("round")}): ${s("latency_ms")} ms, ${s("prompt_tokens")} in / ${s("completion_tokens")} out tokens, $${Number(e.cost_usd ?? 0).toFixed(5)}`;
    case "tool_call":
      return `Tool ${s("name")}${e.args ? ` ${typeof e.args === "string" ? e.args : JSON.stringify(e.args)}` : ""}${e.n_results !== undefined ? ` → ${s("n_results")} results` : ""}${e.error ? ` (error: ${s("error")})` : ""}`;
    case "compression":
      return `History: ${s("history_in")} messages in, ${s("kept")} kept verbatim, ${s("summarized")} summarized (${s("method")})`;
    case "guardrail":
      return `Guardrail: cited ${((e.cited as string[]) ?? []).join(", ") || "nothing"}; removed invalid tags ${((e.removed_invalid_tags as string[]) ?? []).join(", ") || "none"}${e.forced_refusal ? "; forced refusal" : ""}`;
    case "verification":
      return `Verification: faithfulness ${pct((e.faithfulness as { score?: number })?.score)}, citation correctness ${pct(e.citation_correctness as number)}`;
    case "evidence_budget":
      return `Evidence sent: ${s("sent_chars")} of ${s("budget")} characters (deduplicated ${s("deduped")}, truncated ${s("truncated")})`;
    default:
      return `${e.kind}`;
  }
}

function TraceView({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="answer-trace" onToggle={(event) => {
      if ((event.target as HTMLDetailsElement).open && !trace) getTrace(traceId).then(setTrace).catch((e: Error) => setError(e.message));
    }}>
      <summary>How this answer was made (trace {traceId})</summary>
      {error && <p className="field-error">{error}</p>}
      {!trace && !error && <p className="field-help">Loading…</p>}
      {trace && (
        <ol className="trace-list">
          {trace.events.map((e, i) => <li key={i}><span className="trace-t">{e.t_ms} ms</span> {traceLine(e)}</li>)}
        </ol>
      )}
    </details>
  );
}

export function AnswerView({ answer, id, recordHref, onLink, live = false }: {
  answer: AssistantAnswer;
  id: string;
  recordHref: (psiId: string) => string | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
  live?: boolean;
}) {
  const anchor = (ref: string) => `${id}-${ref}`;
  const v = answer.verification;
  const faith = v?.faithfulness?.score;
  return (
    <article className="answer">
      <p className="answer-q"><span>Question</span> {answer.question}</p>
      {answer.refused && <p className="answer-flag">Not enough evidence in the NASA sources to answer fully.</p>}
      <Markdown text={answer.answer} anchor={anchor} />
      {answer.warnings.length > 0 && (
        <ul className="answer-warnings" aria-label="Checks and warnings">
          {answer.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <ul className="answer-chips" aria-label="Answer details">
        {answer.mode && <li>{answer.mode === "llm" ? "Written by DeepSeek" : "Offline: source passages"}</li>}
        {v?.claims ? <li className={level(faith)} title="Claims found in any retrieved passage">Faithfulness {pct(faith)}</li> : null}
        {v?.claims ? <li className={level(v.citation_correctness)} title="Cited claims supported by their own tagged source">Citations {pct(v.citation_correctness)}</li> : null}
        {v?.inference ? <li className="fair" title="Sentences with inference or generalization wording">Inference {v.inference}</li> : null}
        {answer.first_word_ms ? <li title="Time until the first streamed word">First word {(answer.first_word_ms / 1000).toFixed(1)} s</li> : null}
        {answer.latency_ms ? <li>Total {(answer.latency_ms / 1000).toFixed(1)} s</li> : null}
        {answer.prompt_tokens ? <li>Tokens {answer.prompt_tokens} in / {answer.completion_tokens ?? 0} out</li> : null}
        {answer.mode ? <li>Cost ${(answer.cost_usd ?? 0).toFixed(4)}</li> : null}
      </ul>
      {v?.checked && !v.sentences ? (
        <p className="answer-meta">
          Citation check: {v.supported ?? 0} of {v.checked} sentences supported by their source, {v.weak ?? 0} weak, {v.unsupported ?? 0} unsupported.
          {answer.latency_ms ? ` Answered in ${(answer.latency_ms / 1000).toFixed(1)} s.` : ""}
        </p>
      ) : null}
      {v?.sentences && v.sentences.length > 0 && <VerificationDetails v={v} anchor={anchor} />}
      {answer.citations.length > 0 && (
        <details className="answer-sources" open>
          <summary>Sources ({answer.citations.length})</summary>
          <ol>{answer.citations.map((c) => <CitationItem key={c.ref} c={c} anchorId={anchor(c.ref)} recordHref={recordHref} onLink={onLink} />)}</ol>
        </details>
      )}
      {answer.suggested_sources && answer.suggested_sources.length > 0 && (
        <details className="answer-sources">
          <summary>Suggested sources for flagged sentences ({answer.suggested_sources.length})</summary>
          <ol>{answer.suggested_sources.map((c) => <CitationItem key={c.ref} c={c} anchorId={`${anchor(c.ref)}-suggested`} recordHref={recordHref} onLink={onLink} />)}</ol>
        </details>
      )}
      {live && answer.trace_id && <TraceView traceId={answer.trace_id} />}
    </article>
  );
}
