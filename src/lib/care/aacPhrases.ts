/**
 * AAC (augmentative and alternative communication) phrase library.
 *
 * A small, curated set of phrases a non-speaking patient can select to have
 * spoken aloud by the device and pushed to the nurse console. It is deliberately
 * a plain data module with no UI: the patient pages render it, tests pin it.
 *
 * LOCALISATION IS HONEST. Only the phrases that map to an existing
 * `GestureName` have vetted translations in `LANGUAGE_DESCRIPTIONS`. Every other
 * phrase is English-only for now — `aacSpeechText` returns the English text and
 * `localized: false` rather than emitting an unreviewed machine translation.
 * See `research/AAC_AND_ACCESSIBILITY_RESEARCH.md`.
 *
 * THE EMERGENCY PHRASE IS ALWAYS PRESENT. `AAC_PHRASES` includes it, and
 * `assertEmergencyPresent` guards the invariant.
 */
import { LANGUAGE_DESCRIPTIONS, type GestureName, type SupportedLanguage } from "@/types";

export type AacCategory = "urgent" | "needs" | "medical" | "social";

export interface AacPhrase {
  id: string;
  /** English text — what gets spoken when no verified translation exists. */
  text: string;
  category: AacCategory;
  /**
   * When set, the phrase re-uses the vetted translation for this gesture
   * (`LANGUAGE_DESCRIPTIONS`), so it is localised in every supported language.
   */
  gesture?: GestureName;
  /** Urgent phrases are surfaced first and styled to stand out. */
  urgent?: boolean;
}

export const AAC_CATEGORY_LABELS: Record<AacCategory, string> = {
  urgent: "Urgent",
  needs: "Needs",
  medical: "Medical",
  social: "Social",
};

export const AAC_PHRASES: readonly AacPhrase[] = Object.freeze([
  // --- urgent -------------------------------------------------------------
  { id: "emergency", text: "Emergency — I need help right now", category: "urgent", gesture: "EMERGENCY", urgent: true },
  { id: "help", text: "Help — I need assistance", category: "urgent", gesture: "HELP", urgent: true },
  { id: "pain", text: "I am in pain", category: "urgent", urgent: true },
  { id: "breath", text: "I can't breathe properly", category: "urgent", urgent: true },
  { id: "fell", text: "I have fallen and I need help", category: "urgent", urgent: true },

  // --- needs --------------------------------------------------------------
  { id: "water", text: "Water or food — I need some", category: "needs", gesture: "WATER" },
  { id: "hungry", text: "I am hungry", category: "needs" },
  { id: "bathroom", text: "I need the bathroom", category: "needs" },
  { id: "cold", text: "I am too cold", category: "needs" },
  { id: "hot", text: "I am too warm", category: "needs" },
  { id: "position", text: "Please help me change position", category: "needs" },
  { id: "rest", text: "I would like to rest", category: "needs" },

  // --- medical ------------------------------------------------------------
  { id: "medicine", text: "It is time for my medicine", category: "medical" },
  { id: "nurse", text: "Please call the nurse", category: "medical" },
  { id: "doctor", text: "I would like to see the doctor", category: "medical" },
  { id: "dizzy", text: "I feel dizzy", category: "medical" },
  { id: "sick", text: "I feel sick", category: "medical" },

  // --- social -------------------------------------------------------------
  { id: "hello", text: "Hello", category: "social", gesture: "HELLO" },
  { id: "yes", text: "Yes", category: "social", gesture: "YES" },
  { id: "no", text: "No", category: "social", gesture: "NO" },
  { id: "thanks", text: "Thank you", category: "social" },
  { id: "lonely", text: "I feel lonely — please stay with me", category: "social" },
  { id: "family", text: "Please call my family", category: "social" },
]);

const ORDER: AacCategory[] = ["urgent", "needs", "medical", "social"];

export function aacPhraseById(id: string): AacPhrase | undefined {
  return AAC_PHRASES.find((p) => p.id === id);
}

/** Phrases grouped in display order; every category is present (may be empty). */
export function aacPhrasesByCategory(): Array<{ category: AacCategory; phrases: AacPhrase[] }> {
  return ORDER.map((category) => ({
    category,
    phrases: AAC_PHRASES.filter((p) => p.category === category),
  }));
}

export interface AacSpeech {
  text: string;
  /** False when the phrase has no vetted translation and English is used. */
  localized: boolean;
}

/**
 * The text to speak for a phrase in a given language.
 *
 * - gesture-mapped phrases use the vetted `LANGUAGE_DESCRIPTIONS` entry;
 * - other phrases return their English text with `localized: false`, so a
 *   caller can (and should) indicate the fallback to the user rather than
 *   pretending a translation exists.
 */
export function aacSpeechText(phrase: AacPhrase, lang: SupportedLanguage): AacSpeech {
  if (phrase.gesture) {
    const translated = LANGUAGE_DESCRIPTIONS[lang]?.[phrase.gesture];
    if (translated) return { text: translated, localized: true };
  }
  return { text: phrase.text, localized: false };
}

/** Throws if the always-available emergency phrase was ever removed. */
export function assertEmergencyPresent(): void {
  const emergency = aacPhraseById("emergency");
  if (!emergency || !emergency.urgent) {
    throw new Error("AAC library must always expose the urgent 'emergency' phrase");
  }
}
