"use client";

import { useMemo } from "react";
import { Volume2 } from "lucide-react";
import {
  AAC_CATEGORY_LABELS,
  aacPhrasesByCategory,
  aacSpeechText,
  type AacPhrase,
} from "@/lib/care/aacPhrases";
import { voiceAlert } from "@/lib/tts";
import { useUiLanguage } from "@/hooks/useUiLanguage";

/**
 * A keyboard- and switch-usable grid of AAC phrases for a patient who cannot
 * speak or use a camera/gesture. Each button is a large tap target, has an
 * explicit `aria-label`, and speaks its text through the existing voice layer.
 *
 * This is an ALTERNATIVE to hand/eye tracking, never a replacement, so it lives
 * alongside them rather than replacing the gesture UI.
 */
export default function QuickPhrases({
  onSend,
  className = "",
}: {
  /** Called after a phrase is spoken so a host page can log/sync it. */
  onSend?: (phrase: AacPhrase, spokenText: string) => void;
  className?: string;
}) {
  const lang = useUiLanguage();
  const groups = useMemo(() => aacPhrasesByCategory(), []);

  const choose = (phrase: AacPhrase) => {
    const spoken = aacSpeechText(phrase, lang);
    voiceAlert.speakDirect(spoken.text, lang);
    onSend?.(phrase, spoken.text);
  };

  return (
    <section aria-label="Quick phrases" className={`card p-6 ${className}`}>
      <h3 className="text-sm font-bold text-[#1f1f1f] mb-1 flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-[#c63a22]" aria-hidden />
        Quick phrases
      </h3>
      <p className="text-[#6e6e6e] text-xs mb-4">
        Tap a phrase to say it aloud. Works with a keyboard or switch.
      </p>

      <div className="space-y-4">
        {groups.map(({ category, phrases }) =>
          phrases.length === 0 ? null : (
            <div key={category} role="group" aria-label={`${AAC_CATEGORY_LABELS[category]} phrases`}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e6e] mb-2">
                {AAC_CATEGORY_LABELS[category]}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {phrases.map((phrase) => {
                  const spoken = aacSpeechText(phrase, lang);
                  return (
                    <button
                      key={phrase.id}
                      type="button"
                      onClick={() => choose(phrase)}
                      aria-label={`Speak: ${phrase.text}`}
                      className={`min-h-[44px] text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                        phrase.urgent
                          ? "bg-[#c63a22] text-white border-[#c63a22] hover:bg-[#a92f18]"
                          : "bg-white text-[#1f1f1f] border-[#ececec] hover:bg-[#f5f3f0]"
                      }`}
                    >
                      <span>{phrase.text}</span>
                      {/* Never imply a translation exists when the phrase is
                          English-only in the current language. */}
                      {!spoken.localized && lang !== "en-US" && (
                        <span
                          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            phrase.urgent ? "bg-white/20" : "bg-[#f5f3f0] text-[#6e6e6e]"
                          }`}
                          title="Spoken in English — no verified translation yet"
                        >
                          EN
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}
