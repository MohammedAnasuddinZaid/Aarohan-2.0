import { describe, expect, it } from "vitest";
import {
  AAC_CATEGORY_LABELS,
  AAC_PHRASES,
  aacPhraseById,
  aacPhrasesByCategory,
  aacSpeechText,
  assertEmergencyPresent,
} from "@/lib/care/aacPhrases";

describe("AAC phrase library — structure", () => {
  it("has unique ids", () => {
    const ids = AAC_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("always exposes exactly one urgent emergency phrase", () => {
    expect(() => assertEmergencyPresent()).not.toThrow();
    const emergencies = AAC_PHRASES.filter((p) => p.id === "emergency");
    expect(emergencies).toHaveLength(1);
    expect(emergencies[0].urgent).toBe(true);
    expect(emergencies[0].gesture).toBe("EMERGENCY");
  });

  it("groups every phrase into a known category, in display order", () => {
    const groups = aacPhrasesByCategory();
    expect(groups.map((g) => g.category)).toEqual(["urgent", "needs", "medical", "social"]);
    const grouped = groups.flatMap((g) => g.phrases.map((p) => p.id)).sort();
    const all = AAC_PHRASES.map((p) => p.id).sort();
    expect(grouped).toEqual(all);
    for (const g of groups) expect(g.phrases.length).toBeGreaterThan(0);
    for (const p of AAC_PHRASES) expect(AAC_CATEGORY_LABELS[p.category]).toBeTruthy();
  });

  it("returns undefined for an unknown id", () => {
    expect(aacPhraseById("nope")).toBeUndefined();
  });
});

describe("AAC phrase library — localisation is honest", () => {
  it("localises gesture-mapped phrases using the vetted translation table", () => {
    const emergency = aacPhraseById("emergency")!;
    const hi = aacSpeechText(emergency, "hi-IN");
    expect(hi.localized).toBe(true);
    // Devanagari block — proves it is not the English string.
    expect(/[\u0900-\u097F]/.test(hi.text)).toBe(true);
    expect(hi.text).not.toBe(emergency.text);

    const en = aacSpeechText(emergency, "en-US");
    expect(en.localized).toBe(true);
    expect(en.text.length).toBeGreaterThan(0);
  });

  it("never fabricates a translation: non-gesture phrases fall back to English and say so", () => {
    const pain = aacPhraseById("pain")!;
    expect(pain.gesture).toBeUndefined();
    const hi = aacSpeechText(pain, "hi-IN");
    expect(hi.localized).toBe(false);
    expect(hi.text).toBe(pain.text);
    // No Indic characters smuggled in.
    expect(/[\u0900-\u0DFF]/.test(hi.text)).toBe(false);
  });

  it("marks English-only fallback in en-US too (no translation implied)", () => {
    const thanks = aacPhraseById("thanks")!;
    expect(aacSpeechText(thanks, "en-US").localized).toBe(false);
  });

  it("keeps the same English text for a gesture phrase across a real translation", () => {
    const yes = aacPhraseById("yes")!;
    expect(aacSpeechText(yes, "ta-IN").localized).toBe(true);
    expect(aacSpeechText(yes, "ta-IN").text).not.toBe(yes.text);
  });
});
