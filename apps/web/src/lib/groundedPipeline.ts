// Source-Grounded SI Pipeline:
// Document -> Extraction -> Evidence Chunks -> Retrieval -> Source-Grounded Synthesis
// Separates Relevance %, Condition Match (EXACT·PARTIAL·UNMATCHED), and
// Completeness (TABLE_CSV_ROWS·ABSTRACT_ONLY·METADATA_ONLY), with pre-LLM circuit-breaker refusal.

import { SOLID_MAX_AMBIENT_O2 } from "./physics.ts";
import { sanitizeText } from "./security.ts";
import type { Investigation, Publication } from "../types.ts";

export type ConditionMatch = "EXACT" | "PARTIAL" | "UNMATCHED";
export type CompletenessTier = "TABLE_CSV_ROWS" | "ABSTRACT_ONLY" | "METADATA_ONLY";
export type GroundedStatus = "DIRECT_TABLE" | "INSUFFICIENT_EVIDENCE";

export interface EvidenceChunk {
  ref: string;
  id: string;
  title: string;
  url: string;
  relevancePct: number;
  conditionMatch: ConditionMatch;
  completeness: CompletenessTier;
  chamberO2: string;
  burnerO2: string;
  fuels: string[];
  runCount: number;
  snippet: string;
}

export interface GroundedRagResult {
  status: GroundedStatus;
  refused: boolean;
  llmCalled: boolean;
  question: string;
  answer: string;
  gapReport: string | null;
  pipelineStages: readonly [
    "DOCUMENT",
    "EXTRACTION",
    "EVIDENCE_CHUNKS",
    "RETRIEVAL",
    "SOURCE_GROUNDED_SYNTHESIS",
  ];
  chunks: EvidenceChunk[];
}

const STOPWORDS = new Set([
  "what", "which", "where", "when", "why", "how", "did", "does", "the", "and", "for", "with", "from", "that", "this",
  "have", "has", "been", "are", "was", "were", "in", "on", "at", "to", "of", "by", "about", "into", "levels", "level",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.%+-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function formatO2ByBasis(inv: Investigation, basis: "ambient" | "oxidizer_stream"): string {
  const obs = inv.conditions.o2.filter((o) => o.basis === basis);
  if (obs.length === 0) return "not recorded";
  const min = Math.min(...obs.map((o) => o.min_percent));
  const max = Math.max(...obs.map((o) => o.max_percent));
  return min === max ? `${min}%` : `${min}–${max}%`;
}

function detectGapQuery(qLower: string): string | null {
  if (/\b(mars|martian|0\.38\s*g|lunar|moon|0\.17\s*g|partial\s+gravity)\b/.test(qLower)) {
    return "GAP: Zero NASA PSI combustion investigations have tested partial gravity (Lunar 0.17g or Martian 0.38g); all flight records are 0g microgravity (ISS / Cygnus) or 1g ground baselines.";
  }
  const o2Match = qLower.match(/(\d+(?:\.\d+)?)\s*%\s*(?:o2|oxygen)/);
  const asksSolid = /\b(solid|pmma|sibal|nomex|ultem|cotton|fabric|acrylic)\b/.test(qLower);
  if (o2Match && asksSolid) {
    const requestedO2 = Number(o2Match[1]);
    if (requestedO2 > SOLID_MAX_AMBIENT_O2) {
      return `GAP: Requested ${requestedO2}% O₂ for solid materials exceeds the maximum tested NASA PSI chamber O₂ for solids (${SOLID_MAX_AMBIENT_O2}% in PSI-25 / BASS-II).`;
    }
  }
  return null;
}

export function buildEvidenceChunks(
  rawQuestion: string,
  investigations: Investigation[],
  publications: Publication[] = [],
): { chunks: EvidenceChunk[]; gapReport: string | null } {
  const cleanQ = sanitizeText(rawQuestion, 400);
  const qLower = cleanQ.toLowerCase();
  const tokens = tokenize(cleanQ);
  const gapReport = detectGapQuery(qLower);

  if (tokens.length === 0) {
    return { chunks: [], gapReport: "GAP: Empty or non-informative query." };
  }

  const o2QueryMatch = qLower.match(/(\d+(?:\.\d+)?)\s*%/);
  const requestedO2 = o2QueryMatch ? Number(o2QueryMatch[1]) : null;

  const scored: EvidenceChunk[] = [];

  for (const inv of investigations) {
    const corpus = [
      inv.id,
      inv.acronym ?? "",
      inv.family ?? "",
      inv.title,
      inv.objective,
      inv.approach,
      inv.hardware ?? "",
      ...inv.conditions.fuels,
    ]
      .join(" ")
      .toLowerCase();

    let hits = 0;
    for (const t of tokens) {
      if (corpus.includes(t)) hits++;
    }
    if (hits === 0) continue;

    const relevancePct = Math.min(99, Math.round((hits / tokens.length) * 100));
    const chamberO2 = formatO2ByBasis(inv, "ambient");
    const burnerO2 = formatO2ByBasis(inv, "oxidizer_stream");

    const completeness: CompletenessTier =
      inv.conditions.run_count > 0 && inv.conditions.tables.length > 0
        ? "TABLE_CSV_ROWS"
        : inv.objective
          ? "ABSTRACT_ONLY"
          : "METADATA_ONLY";

    let conditionMatch: ConditionMatch = "PARTIAL";
    if (requestedO2 !== null) {
      const ambientHit = inv.conditions.o2.some(
        (o) => o.basis === "ambient" && requestedO2 >= o.min_percent && requestedO2 <= o.max_percent,
      );
      const burnerHit = inv.conditions.o2.some(
        (o) => o.basis === "oxidizer_stream" && requestedO2 >= o.min_percent && requestedO2 <= o.max_percent,
      );
      conditionMatch = ambientHit ? "EXACT" : burnerHit ? "PARTIAL" : "UNMATCHED";
    } else if (completeness === "TABLE_CSV_ROWS" && relevancePct >= 50) {
      conditionMatch = "EXACT";
    }

    scored.push({
      ref: `I${scored.length + 1}`,
      id: inv.id,
      title: `${inv.acronym || inv.id}: ${inv.title}`,
      url: inv.source_url,
      relevancePct,
      conditionMatch,
      completeness,
      chamberO2,
      burnerO2,
      fuels: inv.conditions.fuels,
      runCount: inv.conditions.run_count,
      snippet: `${inv.id} (${inv.acronym ?? "PSI"}): ${inv.conditions.run_count} CSV runs. Fuels: ${
        inv.conditions.fuels.length ? inv.conditions.fuels.join(", ") : "not recorded"
      }. Chamber O₂: ${chamberO2}; Burner O₂: ${burnerO2}.`,
    });
  }

  for (const pub of publications.slice(0, 60)) {
    const pubText = `${pub.title} ${pub.authors} ${pub.abstract ?? ""}`.toLowerCase();
    let hits = 0;
    for (const t of tokens) {
      if (pubText.includes(t)) hits++;
    }
    if (hits < 2) continue;
    const relevancePct = Math.min(92, Math.round((hits / tokens.length) * 85));
    scored.push({
      ref: `P${scored.length + 1}`,
      id: pub.id,
      title: pub.title,
      url: pub.doi ? `https://doi.org/${pub.doi}` : "https://psi.nasa.gov",
      relevancePct,
      conditionMatch: "PARTIAL",
      completeness: pub.abstract ? "ABSTRACT_ONLY" : "METADATA_ONLY",
      chamberO2: "not recorded",
      burnerO2: "not recorded",
      fuels: [],
      runCount: 0,
      snippet: pub.abstract ? pub.abstract.slice(0, 220) : `Publication metadata (${pub.authors}).`,
    });
  }

  scored.sort((a, b) => b.relevancePct - a.relevancePct || b.runCount - a.runCount);
  const top = scored.slice(0, 5).map((c, idx) => ({ ...c, ref: `S${idx + 1}` }));
  return { chunks: top, gapReport };
}

export function runGroundedPipelineSync(
  rawQuestion: string,
  investigations: Investigation[],
  publications: Publication[] = [],
): GroundedRagResult {
  const question = sanitizeText(rawQuestion, 400);
  const stages = [
    "DOCUMENT",
    "EXTRACTION",
    "EVIDENCE_CHUNKS",
    "RETRIEVAL",
    "SOURCE_GROUNDED_SYNTHESIS",
  ] as const;

  const { chunks, gapReport } = buildEvidenceChunks(question, investigations, publications);

  // Circuit-breaker refusal BEFORE calling LLM if there is a hard GAP or insufficient evidence
  const hasExactOrTable = chunks.some((c) => c.completeness === "TABLE_CSV_ROWS" && c.conditionMatch !== "UNMATCHED");
  if (chunks.length === 0 || gapReport !== null || !hasExactOrTable) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      refused: true,
      llmCalled: false,
      question,
      gapReport: gapReport ?? "GAP: No matching NASA PSI experimental records or verified CSV rows found for this query.",
      answer:
        gapReport ??
        "INSUFFICIENT_EVIDENCE: The NASA PSI catalog does not contain verified experimental records matching your query. Circuit-breaker engaged prior to LLM synthesis.",
      pipelineStages: stages,
      chunks,
    };
  }

  const lines = chunks.map(
    (c) =>
      `- **[${c.ref}] ${c.title}** — Relevance ${c.relevancePct}% | Match: \`${c.conditionMatch}\` | Completeness: \`${c.completeness}\` | Chamber O₂: **${c.chamberO2}** | Burner O₂: **${c.burnerO2}** | Fuels: ${
        c.fuels.length ? c.fuels.join(", ") : "not recorded"
      } (${c.runCount} runs) [${c.ref}]`,
  );

  const summaryHeader = gapReport
    ? `**Boundary Warning:** ${gapReport}\n\nClosest verified NASA PSI records:`
    : `Verified evidence retrieved from ${chunks.length} NASA PSI source chunks:`;

  return {
    status: "DIRECT_TABLE",
    refused: false,
    llmCalled: false,
    question,
    gapReport,
    answer: `${summaryHeader}\n${lines.join("\n")}`,
    pipelineStages: stages,
    chunks,
  };
}
