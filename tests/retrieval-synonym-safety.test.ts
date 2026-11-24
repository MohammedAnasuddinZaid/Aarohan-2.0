import { describe, expect, it } from "vitest";
import { buildPatientPassages, expandTerms, retrievePassages } from "@/lib/care/retrieval";
import { getSeedPatient } from "@/lib/care/seedPatients";

/**
 * Guardrail against unsafe synonym expansion.
 *
 * The brief's P0 concern: a medication name, a symptom and a diagnosis must
 * never become interchangeable just because they share a keyword. These tests
 * pin the curated table so a future edit cannot silently re-merge them.
 */
describe("synonym expansion — clinical safety", () => {
  it("does not turn a hydration word into a specific drug", () => {
    const terms = expandTerms("is she drinking enough water");
    expect(terms).not.toContain("furosemide");
    expect(terms).not.toContain("diuretic");
    expect(terms).not.toContain("swelling");
    // The safe hydration synonyms survive.
    expect(terms).toContain("fluid");
  });

  it("never merges a medicine with a diagnosis", () => {
    // Medicine -> other medicines is fine; medicine -> diagnosis is not.
    expect(expandTerms("antibiotic")).not.toContain("infection");
    expect(expandTerms("antibiotics")).not.toContain("infection");
    expect(expandTerms("sepsis")).not.toContain("antibiotic");
  });

  it("does not expand an everyday word into an anticoagulant", () => {
    const terms = expandTerms("the patient is thin");
    expect(terms).not.toContain("warfarin");
    expect(terms).not.toContain("apixaban");
  });

  it("does not widen 'sugar' into the generic word 'blood'", () => {
    const terms = expandTerms("what is her sugar");
    expect(terms).not.toContain("blood");
    expect(terms).toContain("glucose");
  });
});

describe("synonym expansion — still useful where it is safe", () => {
  it("keeps abbreviation and organ/lab expansions", () => {
    expect(expandTerms("bp")).toEqual(expect.arrayContaining(["blood", "pressure"]));
    expect(expandTerms("spo2")).toEqual(expect.arrayContaining(["oxygen", "saturation"]));
    expect(expandTerms("kidney")).toEqual(expect.arrayContaining(["renal"]));
  });
});

describe("retrieval — a hydration question does not surface a drug", () => {
  it("never ranks a medication passage for a plain water question", () => {
    const anita = getSeedPatient("pt_0001")!; // takes furosemide
    const passages = buildPatientPassages(anita);
    const result = retrievePassages("is she drinking enough water", passages);
    expect(result.passages.every((p) => p.kind !== "medication")).toBe(true);
  });
});
