/**
 * Cache-Augmented Generation (CAG) for the care assistant.
 *
 * Retrieval answers "which few passages match this question?". CAG answers the
 * opposite: for a patient whose whole chart fits comfortably in the model's
 * context window, preload ALL of it. When the chart is small this is strictly
 * better than retrieval — nothing relevant can be missed by a weak query, and
 * the model never has to guess what it was not shown. When the chart is large
 * the caller falls back to `retrievePassages` + `retrievalContext`.
 *
 * This module is pure and deterministic: it ranks passages by clinical kind
 * (demographics, then allergies and medications, then conditions, observations,
 * notes) and truncates by whole passages only, so the same chart always
 * produces the same context. It invents nothing — every line comes from
 * `buildPatientPassages`.
 */
import type { ClinicalPatient, PatientRecord } from "./types";
import {
  buildPatientPassages,
  type Passage,
  type PassageKind,
  type PatientExtras,
} from "./retrieval";

/** Roughly 6000-9000 tokens. Conservative for the fast models we call. */
export const CAG_MAX_CHARS = 9000;

const KIND_ORDER: Record<PassageKind, number> = {
  profile: 0,
  allergy: 1,
  medication: 2,
  condition: 3,
  careplan: 4,
  observation: 5,
  encounter: 6,
  record: 7,
  report: 8,
  transcript: 9,
  task: 10,
  message: 11,
  knowledge: 12,
};

export interface CagContext {
  /** Prompt-ready block, or "" when there is nothing to include. */
  text: string;
  chars: number;
  included: number;
  omitted: number;
  /** True when the entire chart fit inside the budget. */
  complete: boolean;
}

/** Deterministic, dependency-free token estimate (~4 characters per token). */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

function block(passage: Passage, index: number): string {
  const header = `[C${index + 1}] ${passage.title}${passage.source ? ` (${passage.source})` : ""}`;
  const body = passage.text.replace(/\s+/g, " ").trim().slice(0, 1800);
  return `${header}\n${body}`;
}

export function buildCagContext(
  patient: ClinicalPatient,
  records: PatientRecord[] = [],
  extras: PatientExtras = {},
  maxChars = CAG_MAX_CHARS
): CagContext {
  const passages = buildPatientPassages(patient, records, extras);
  const ordered = passages
    .map((passage, index) => ({ passage, index }))
    .sort((a, b) => KIND_ORDER[a.passage.kind] - KIND_ORDER[b.passage.kind] || a.index - b.index)
    .map((entry) => entry.passage);

  const out: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const passage of ordered) {
    const next = block(passage, out.length);
    // Oversized single passages are skipped, not cut mid-sentence: a truncated
    // clinical fact is worse than an omitted one the fallback can still rank.
    if (used + next.length > maxChars && out.length) {
      omitted++;
      continue;
    }
    out.push(next);
    used += next.length;
  }

  return {
    text: out.join("\n\n"),
    chars: used,
    included: out.length,
    omitted,
    complete: omitted === 0,
  };
}
