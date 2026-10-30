// Source: packages/core/src/healthcheck/similarity.ts and evaluate.ts (description
// checks). Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited).
/**
 * Text helpers for the description checks: does a business description read
 * as finished and written for people, and is it a copy of a sibling venue's.
 * Pure and client-safe.
 */

/** Lowercase letters and digits only, split on anything else. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Words too common to count as keyword stuffing. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "near",
  "with",
  "from",
  "your",
  "our",
  "you",
  "are",
  "this",
  "that",
  "have",
  "has",
  "of",
  "a",
  "an",
  "to",
  "at",
  "in",
  "on",
  "we",
])

/** A scheme, `www.`, or a bare domain on a common top-level domain. */
const LINK =
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|info|biz|io|co|uk|pub|eu)\b/i

/** Google doesn't allow links of any kind in a business description. */
export function containsLink(text: string): boolean {
  return LINK.test(text)
}

export type DescriptionRules = {
  minChars?: number
  maxUppercaseShare?: number
  maxWordRepeats?: number
}

/**
 * What makes a description read as unfinished or as spam, one phrase each;
 * empty when it reads fine.
 */
export function descriptionProblems(
  text: string,
  rules: DescriptionRules = {}
): string[] {
  const minChars = rules.minChars ?? 250
  const maxUppercaseShare = rules.maxUppercaseShare ?? 0.5
  const maxWordRepeats = rules.maxWordRepeats ?? 4
  const problems: string[] = []
  const length = [...text.trim()].length
  if (length < minChars)
    problems.push(`is only ${length} characters; aim for at least ${minChars}`)
  const letters = text.replace(/[^\p{L}]/gu, "")
  const upper = letters.replace(/[^\p{Lu}]/gu, "")
  if (letters.length >= 20 && upper.length / letters.length > maxUppercaseShare)
    problems.push("is mostly capital letters")
  const counts = new Map<string, number>()
  for (const word of words(text))
    if (word.length >= 4 && !STOP.has(word))
      counts.set(word, (counts.get(word) ?? 0) + 1)
  const stuffed = [...counts].find(([, count]) => count > maxWordRepeats)
  if (stuffed)
    problems.push(
      `repeats “${stuffed[0]}” ${stuffed[1]} times, which can look like spam`
    )
  if (containsLink(text))
    problems.push("contains a link, which Google doesn’t allow")
  return problems
}

/** Dice coefficient over character bigrams of the normalised text, 0 to 1. */
export function similarity(a: string, b: string): number {
  const left = words(a).join(" ")
  const right = words(b).join(" ")
  if (!left || !right) return 0
  if (left === right) return 1
  const grams = (text: string) => {
    const counts = new Map<string, number>()
    for (let index = 0; index < text.length - 1; index++) {
      const gram = text.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
    return counts
  }
  const leftGrams = grams(left)
  const rightGrams = grams(right)
  let shared = 0
  for (const [gram, count] of leftGrams)
    shared += Math.min(count, rightGrams.get(gram) ?? 0)
  const total = left.length - 1 + (right.length - 1)
  return total > 0 ? (2 * shared) / total : 0
}
