import type { MouseEvent, ReactNode } from "react";
import type { AssistantAnswer, AssistantCitation } from "../lib/assistant";

// The assistant answers in light Markdown: paragraphs, "- " bullets, **bold**, pipe tables
// and citation tags like [S1] / [I2]. Rendered as React elements (never innerHTML).
const TAG = /\[((?:[SIP]\d+)(?:\]\[[SIP]\d+)*)\]/g;

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

function Markdown({ text, anchor }: { text: string; anchor: (ref: string) => string }) {
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
  return (
    <li id={anchorId}>
      <span className="cite-ref">[{c.ref}]</span>
      <div>
        <p className="cite-title">{c.title}{c.page ? `, p. ${c.page}` : ""}</p>
        {c.snippet && <p className="cite-snippet">{c.snippet}</p>}
        <p className="cite-links">
          {external && <a href={external} target="_blank" rel="noreferrer">{c.page ? `Open the PDF at page ${c.page}` : "Open the source"}</a>}
          {internal && <a href={internal} onClick={onLink}>Open {c.source_id} in the experiment library</a>}
        </p>
      </div>
    </li>
  );
}

export function AnswerView({ answer, id, recordHref, onLink }: {
  answer: AssistantAnswer;
  id: string;
  recordHref: (psiId: string) => string | null;
  onLink: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const anchor = (ref: string) => `${id}-${ref}`;
  const v = answer.verification;
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
      {v?.checked ? (
        <p className="answer-meta">
          Citation check: {v.supported ?? 0} of {v.checked} sentences supported by their source, {v.weak ?? 0} weak, {v.unsupported ?? 0} unsupported.
          {answer.latency_ms ? ` Answered in ${(answer.latency_ms / 1000).toFixed(1)} s.` : ""}
        </p>
      ) : null}
      {answer.citations.length > 0 && (
        <details className="answer-sources" open>
          <summary>Sources ({answer.citations.length})</summary>
          <ol>{answer.citations.map((c) => <CitationItem key={c.ref} c={c} anchorId={anchor(c.ref)} recordHref={recordHref} onLink={onLink} />)}</ol>
        </details>
      )}
    </article>
  );
}
