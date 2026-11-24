/**
 * Chart-grounded demo questions.
 *
 * A presenter standing in front of a judge should never have to invent a
 * question and hope the record answers it. This module reads a patient's own
 * chart and returns questions whose answers are provably in the passages the
 * assistant will cite — one per allergy, the newest reading of every
 * observation series, the care plan, the active problem list, the current
 * medicines and the most recent contact.
 *
 * It is deterministic and offline: the same chart always yields the same
 * questions, and every question names the field it is grounded in (`basis`), so
 * a UI can show "answered from: allergy / observation:Potassium" and tests can
 * assert the answer exists. It never invents a fact — it only asks about facts
 * already in the chart.
 */
import type { ClinicalPatient } from "./types";

export interface ChartQuestion {
  question: string;
  /** The chart field the answer comes from, e.g. "observation:Potassium". */
  basis: string;
}

export interface ChartQuestionOptions {
  /** Titles of inserted records, to offer a "summarise the record" question. */
  recordTitles?: string[];
  /** Overall cap on the number of questions returned. */
  limit?: number;
}

function firstName(patient: ClinicalPatient): string {
  return patient.displayName.trim().split(/\s+/)[0] || "the patient";
}

/** The most recent reading of every distinct observation label, newest first. */
function newestPerLabel(patient: ClinicalPatient): Array<{ label: string; at: string }> {
  const byLabel = new Map<string, string>();
  for (const o of patient.observations) {
    const prev = byLabel.get(o.label);
    if (!prev || o.at > prev) byLabel.set(o.label, o.at);
  }
  return [...byLabel.entries()]
    .map(([label, at]) => ({ label, at }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Builds the questions, ordered by demo value: safety first (allergies), then
 * the live-looking vitals, the plan, the problem list, the medicines and the
 * latest contact. Caller can cap with `limit`.
 */
export function buildChartQuestions(
  patient: ClinicalPatient | null | undefined,
  opts: ChartQuestionOptions = {}
): ChartQuestion[] {
  if (!patient) return [];
  const name = firstName(patient);
  const out: ChartQuestion[] = [];
  const push = (question: string, basis: string) => out.push({ question, basis });

  // 1. Safety first: the allergy question a nurse must never miss.
  if (patient.allergies.length) {
    const mildOnly = patient.allergies.every((a) => a.severity === "mild");
    push(
      mildOnly
        ? `What is ${name} allergic to, and how serious is it?`
        : `What is ${name} allergic to, and what reaction happens?`,
      "allergy"
    );
  }

  // 2. The newest reading of each measure — the "what are the numbers" question.
  for (const { label } of newestPerLabel(patient).slice(0, 3)) {
    push(`What is ${name}'s latest ${label} reading, and how has it changed?`, `observation:${label}`);
  }

  // 3. The plan.
  if (patient.carePlan) push(`What is ${name}'s care plan?`, "careplan");

  // 4. The active problem list.
  for (const c of patient.conditions.filter((c) => c.status === "active").slice(0, 2)) {
    push(`Explain ${name}'s ${c.name} in plain English`, `condition:${c.name}`);
  }

  // 5. Current medicines (two named, then a summary if there are more).
  const activeMeds = patient.medications.filter((m) => m.status === "active");
  for (const m of activeMeds.slice(0, 2)) {
    push(`What is ${name}'s ${m.name} for, and what dose is it?`, `medication:${m.name}`);
  }
  if (activeMeds.length > 2) push(`What medications is ${name} on?`, "medications:summary");

  // 6. The most recent contact.
  const recent = [...patient.encounters].sort((a, b) => b.at.localeCompare(a.at));
  if (recent.length) push(`What happened at ${name}'s most recent contact?`, `encounter:${recent[0].id}`);

  // 7. One inserted document.
  const title = (opts.recordTitles ?? []).find((t) => t.trim().length > 0);
  if (title) push(`Summarise the "${title}" record`, "record");

  const seen = new Set<string>();
  const unique = out.filter((q) => {
    const key = q.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return typeof opts.limit === "number" ? unique.slice(0, opts.limit) : unique;
}

/** Plain strings, ready for a suggestion chip or a demo script. */
export function chartQuestionStrings(
  patient: ClinicalPatient | null | undefined,
  opts: ChartQuestionOptions = {}
): string[] {
  return buildChartQuestions(patient, opts).map((q) => q.question);
}
