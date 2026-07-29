import { detectAll, toISO2 } from "tinyld"

const SUPPORTED_LANGUAGES = [
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "nl",
  "ar",
  "ru",
  "ja",
  "hi",
] as const

function scriptLanguage(text: string): string | null {
  if (/[\u0600-\u06ff]/u.test(text)) return "ar"
  if (/[\u0400-\u04ff]/u.test(text)) return "ru"
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) return "ja"
  if (/[\u0900-\u097f]/u.test(text)) return "hi"
  return null
}

export function detectLanguage(text: string | null): {
  code: string | null
  confidence: number | null
} {
  const value = text?.trim()
  if (!value) return { code: null, confidence: null }
  if (value.replace(/\s/gu, "").length < 12) {
    const code = scriptLanguage(value)
    return {
      code,
      confidence: code ? 1 : null,
    }
  }
  const [candidate] = detectAll(value, {
    only: [...SUPPORTED_LANGUAGES],
  })
  if (!candidate) return { code: null, confidence: null }
  return {
    code: toISO2(candidate.lang),
    confidence: candidate.accuracy,
  }
}
