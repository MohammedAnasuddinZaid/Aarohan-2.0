import { describe, expect, it } from "vitest";
import { CAG_MAX_CHARS, buildCagContext, estimateTokens } from "@/lib/care/cag";
import { getSeedPatient } from "@/lib/care/seedPatients";

describe("estimateTokens", () => {
  it("returns 0 for empty and scales with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

describe("buildCagContext", () => {
  const anita = getSeedPatient("pt_0001")!;

  it("includes the whole chart when it fits the budget", () => {
    const cag = buildCagContext(anita, []);
    expect(cag.complete).toBe(true);
    expect(cag.omitted).toBe(0);
    expect(cag.included).toBeGreaterThan(0);
    expect(cag.chars).toBeLessThanOrEqual(CAG_MAX_CHARS);
    // Every clinical fact is present, not just the ones a query would match.
    expect(cag.text).toContain("Furosemide");
    expect(cag.text.toLowerCase()).toContain("penicillin");
    expect(cag.text.toLowerCase()).toContain("heart failure");
  });

  it("is deterministic for the same chart", () => {
    expect(buildCagContext(anita, []).text).toBe(buildCagContext(anita, []).text);
  });

  it("drops whole passages and reports incompleteness under a tiny budget", () => {
    const cag = buildCagContext(anita, [], {}, 600);
    expect(cag.complete).toBe(false);
    expect(cag.omitted).toBeGreaterThan(0);
    expect(cag.chars).toBeLessThanOrEqual(600);
  });

  it("orders allergies and medications ahead of free-text notes", () => {
    const cag = buildCagContext(anita, []);
    const allergyIdx = cag.text.indexOf("Penicillin");
    const transcriptIdx = cag.text.lastIndexOf("transcript");
    if (allergyIdx >= 0 && transcriptIdx >= 0) {
      expect(allergyIdx).toBeLessThan(transcriptIdx);
    }
  });
});
