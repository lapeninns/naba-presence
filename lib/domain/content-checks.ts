import type { VerificationReason } from "@/lib/domain/verification"

/** Comparison form shared by literal phrase and repetition checks. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘\x27]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function bannedPhraseChecks(
  body: string,
  phrases: readonly string[]
): VerificationReason[] {
  const text = ` ${normalise(body)} `
  return phrases.some((phrase) => {
    const candidate = normalise(phrase)
    return candidate.length > 0 && text.includes(` ${candidate} `)
  })
    ? [
        {
          code: "banned_phrase",
          severity: "fail",
          message:
            "The text contains a phrase banned by your organisation’s reply policy.",
        },
      ]
    : []
}

/** Unicode code-point edit distance, bounded by the provider reply size. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const left = Array.from(a)
  const right = Array.from(b)
  if (
    Math.min(left.length, right.length) / Math.max(left.length, right.length) <
    0.9
  )
    return 0
  const maxDistance = Math.floor(Math.max(left.length, right.length) * 0.1)
  let row = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 0; i < left.length; i++) {
    const next = new Array<number>(right.length + 1).fill(Infinity)
    next[0] = i + 1
    for (
      let j = Math.max(0, i - maxDistance);
      j < Math.min(right.length, i + maxDistance + 1);
      j++
    ) {
      next[j + 1] = Math.min(
        next[j] + 1,
        row[j + 1] + 1,
        row[j] + (left[i] === right[j] ? 0 : 1)
      )
    }
    if (Math.min(...next) > maxDistance) return 0
    row = next
  }
  return 1 - row[right.length] / Math.max(left.length, right.length)
}

function opening(body: string): string {
  return normalise(body.trim().split(/[.!?]+(?:\s|$)|\n/u)[0])
}

export function replyRepetitionChecks(input: {
  body: string
  recentPublishedReplies: readonly string[]
  ratingOnlyTemplate?: boolean
}): VerificationReason[] {
  if (input.ratingOnlyTemplate) return []
  const body = normalise(input.body)
  if (!body || Array.from(body).length > 4096) return []
  const recent = input.recentPublishedReplies.slice(0, 30)
  if (recent.some((reply) => similarity(body, normalise(reply)) >= 0.9)) {
    return [
      {
        code: "reply_duplicate",
        severity: "fail",
        message:
          "This reply is too similar to a recent published reply for this client. Write a reply specific to this review.",
      },
    ]
  }
  const first = opening(input.body)
  return first && recent.some((reply) => opening(reply) === first)
    ? [
        {
          code: "reply_repeated_opening",
          severity: "warn",
          message:
            "This opening sentence matches a recent published reply for this client.",
        },
      ]
    : []
}

export function contentChecks(input: {
  kind: "post" | "description"
  allowEmpty?: boolean
  body: string
  bannedPhrases?: readonly string[]
  offerEndDate?: string | null
  /** ISO calendar date in the location’s timezone, supplied by the server. */
  today?: string
}): VerificationReason[] {
  const reasons = bannedPhraseChecks(input.body, input.bannedPhrases ?? [])
  const label = input.kind === "post" ? "post" : "description"
  const add = (code: string, severity: "warn" | "fail", message: string) =>
    reasons.push({ code, severity, message })
  if (input.kind === "post" && !input.body.trim() && !input.allowEmpty)
    add("content_empty", "fail", `The ${label} is empty.`)
  const limit = input.kind === "post" ? 1500 : 750
  if (Array.from(input.body).length > limit)
    add(
      "content_too_long",
      "fail",
      `The ${label} exceeds Google’s ${limit}-character limit.`
    )
  // Require a phone-sized run; venue numbers, prices and 24/7 are not contact data.
  const withoutDates = input.body.replace(/\b\d{4}-\d{2}-\d{2}\b/gu, " ")
  if (
    [
      ...withoutDates.matchAll(
        /(?<![\p{L}\p{N}])\+?\d[\d ().-]{5,}\d(?![\p{L}\p{N}])/gu
      ),
    ].some(([match]) => match.replace(/\D/gu, "").length >= 7)
  )
    add(
      "content_phone",
      "fail",
      `Remove phone numbers from the ${label}. Use the profile’s phone field.`
    )
  if (
    /(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}](?:[\p{L}\p{N}-]*\.)+(?:[\p{L}]{2,63})\b/iu.test(
      input.body
    )
  )
    add(
      "content_url",
      "fail",
      `Remove links from the ${label}. ${input.kind === "post" ? "Use the call-to-action button URL." : "Use the website field."}`
    )
  const letters = input.body.match(/\p{L}/gu)?.join("") ?? ""
  if (
    letters.length >= 10 &&
    letters.toUpperCase() === letters &&
    letters.toLowerCase() !== letters
  )
    add(
      "content_caps",
      "warn",
      `The ${label} is written in all capitals. Use sentence case for readability.`
    )
  if (/[!?]{3,}/u.test(input.body))
    add(
      "content_punctuation",
      "warn",
      `The ${label} uses repeated punctuation. Check the tone before continuing.`
    )
  if (
    input.kind === "post" &&
    input.offerEndDate &&
    input.today &&
    input.offerEndDate < input.today
  )
    add(
      "offer_expired",
      "fail",
      "This offer has already ended. Update its end date before publishing."
    )
  return reasons
}
