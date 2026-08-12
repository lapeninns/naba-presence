// Google returns a machine-translated review as one string carrying both
// languages: "(Translated by Google) <english> (Original) <source>". Rendering
// that blob verbatim — as the pane used to — puts two languages under one
// `lang` attribute (wrong for half of it, and unreadable to a screen reader)
// and reads to a human as the same sentence typed twice. Split it so each
// language gets its own block, its own tag, and its own turn on screen.
const GOOGLE_TRANSLATION =
  /^\(Translated by Google\)\s*([\s\S]*?)\s*\(Original\)\s*([\s\S]*)$/

// The translation target is always the product locale (spec §7 pins en-GB),
// never the detected source language — that code belongs to the original.
const TRANSLATION_TARGET = "en"

export type ReviewText = {
  /** Shown first: the translation when there is one, else the review as written. */
  body: string
  bodyLang: string | null
  /** The reviewer's own words. Only set when Google translated the review. */
  original: string | null
  originalLang: string | null
}

/** Returns `null` for a rating-only review (no written text). */
export function parseReviewText(
  text: string | null,
  detectedLanguageCode: string | null
): ReviewText | null {
  const trimmed = text?.trim()
  if (!trimmed) return null

  const asWritten: ReviewText = {
    body: trimmed,
    bodyLang: detectedLanguageCode,
    original: null,
    originalLang: null,
  }

  const match = GOOGLE_TRANSLATION.exec(trimmed)
  if (!match) return asWritten

  const translated = match[1]?.trim()
  const original = match[2]?.trim()
  // A marker with nothing either side of it is not a translation worth
  // splitting — fall back to showing the string as Google sent it rather than
  // rendering an empty block.
  if (!translated || !original) return asWritten

  return {
    body: translated,
    bodyLang: TRANSLATION_TARGET,
    original,
    // Google's detected-language code describes the review row, and on a
    // translated review it frequently comes back as the TRANSLATION's
    // language rather than the source — a Polish review arrives tagged "en".
    // A review translated into English cannot have an English original, so
    // when the code matches the target we admit we do not know the source
    // language rather than mislabelling it (and mis-tagging its pronunciation
    // for a screen reader).
    originalLang: isTranslationTarget(detectedLanguageCode)
      ? null
      : detectedLanguageCode,
  }
}

function isTranslationTarget(code: string | null): boolean {
  return code?.toLowerCase().split("-")[0] === TRANSLATION_TARGET
}
