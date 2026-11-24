import { describe, expect, it } from "vitest";
import { buildPatientPassages, retrievePassages } from "@/lib/care/retrieval";
import { getSeedPatient } from "@/lib/care/seedPatients";
import dataset from "./fixtures/rag-eval.json";

/**
 * Committed retrieval evaluation. This is a regression guard over the
 * deterministic MiniSearch retriever, not a clinical benchmark: the questions
 * and expected facts come from the synthetic demo charts. Thresholds are set
 * just below the measured values so an honest change passes and a regression
 * fails. Re-run with `npm run eval:rag`.
 */

interface Case {
  patientId: string;
  question: string;
  expect?: string;
}

const K = dataset.k;

function topPassages(patientId: string, question: string) {
  const patient = getSeedPatient(patientId);
  if (!patient) throw new Error(`unknown patient ${patientId}`);
  const passages = buildPatientPassages(patient);
  return retrievePassages(question, passages, { limit: K });
}

describe("retrieval evaluation (recall@k + MRR)", () => {
  it("finds the passage answering every positive question", () => {
    let hits = 0;
    let reciprocalRankSum = 0;
    const misses: string[] = [];

    for (const c of dataset.positive as Case[]) {
      const needle = (c.expect ?? "").toLowerCase();
      const result = topPassages(c.patientId, c.question);
      const rank = result.passages.findIndex((p) => p.text.toLowerCase().includes(needle));
      if (rank >= 0) {
        hits++;
        reciprocalRankSum += 1 / (rank + 1);
      } else {
        misses.push(`${c.patientId} :: ${c.question}`);
      }
    }

    const recall = hits / dataset.positive.length;
    const mrr = reciprocalRankSum / dataset.positive.length;
    // eslint-disable-next-line no-console
    console.log(
      `[rag-eval] positive=${dataset.positive.length} recall@${K}=${recall.toFixed(3)} MRR=${mrr.toFixed(3)}`
    );
    if (misses.length) {
      // eslint-disable-next-line no-console
      console.log(`[rag-eval] misses:\n${misses.join("\n")}`);
    }

    // Baseline measured on the committed dataset: recall@5 0.957, MRR 0.891.
    // Thresholds sit below it as a regression guard, not a target.
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(mrr).toBeGreaterThanOrEqual(0.75);
  });

  it("never reports a strong match for an unrelated question", () => {
    for (const c of dataset.negative as Case[]) {
      const result = topPassages(c.patientId, c.question);
      expect(result.strong, `${c.patientId} :: ${c.question}`).toBe(false);
    }
  });
});
