/**
 * The default reply languages offered by name. The server accepts any code
 * matching `^[a-z]{2,3}(-[A-Z]{2})?$`; this list is English in its regional
 * forms plus the languages review detection recognises
 * (`lib/domain/language.ts`), which are the ones a draft can be asked for.
 */
export const LANGUAGE_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "en-GB", label: "English (UK)" },
  { code: "en-US", label: "English (US)" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" },
]

/** A plain name for any stored code, including one not in the list. */
export function languageLabel(code: string): string {
  const known = LANGUAGE_OPTIONS.find((option) => option.code === code)
  if (known) return known.label
  try {
    return (
      new Intl.DisplayNames(["en-GB"], { type: "language" }).of(code) ?? code
    )
  } catch {
    return code
  }
}

/** The list, with a stored code outside it kept so the select can show it. */
export function languageOptionsFor(
  current: string
): readonly { code: string; label: string }[] {
  return LANGUAGE_OPTIONS.some((option) => option.code === current)
    ? LANGUAGE_OPTIONS
    : [{ code: current, label: languageLabel(current) }, ...LANGUAGE_OPTIONS]
}
