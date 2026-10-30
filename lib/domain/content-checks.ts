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

/**
 * One reason per banned phrase the text contains, quoting the phrase as the
 * organisation wrote it, so the person knows what to remove and where the
 * list is kept.
 */
export function bannedPhraseChecks(
  body: string,
  phrases: readonly string[]
): VerificationReason[] {
  const text = ` ${normalise(body)} `
  const seen = new Set<string>()
  return phrases.flatMap((phrase): VerificationReason[] => {
    const candidate = normalise(phrase)
    if (!candidate || seen.has(candidate) || !text.includes(` ${candidate} `))
      return []
    seen.add(candidate)
    return [
      {
        code: "banned_phrase",
        severity: "fail",
        message: `“${phrase.trim()}” is on your banned-phrase list (Settings › Reply policy).`,
      },
    ]
  })
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
  const limit = input.kind === "post" ? 1500 : 750
  if (Array.from(input.body).length > limit)
    add(
      "content_too_long",
      "fail",
      `The ${label} exceeds Google’s ${limit.toLocaleString("en-GB")}-character limit.`
    )
  if (containsPhoneNumber(input.body))
    add(
      "content_phone",
      "fail",
      `Remove phone numbers from the ${label}. Use the profile’s phone field.`
    )
  if (containsLink(input.body))
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

/**
 * Text that is never contact data, removed before looking for phone
 * numbers: ISO dates (2026-12-25), clock times and prices with two decimal
 * places (12.00, 10:30, 9.30pm, £12.50) and year ranges (2026 - 2027,
 * 2026–27). Replaced with a letter so the digits either side stay apart.
 */
const NOT_A_PHONE = [
  /(?<![\p{N}.:])\d{4}-\d{2}-\d{2}(?![\p{N}])/gu,
  /(?<![\p{N}.:])\d{1,2}[.:]\d{2}(?![\p{N}.:])(?:\s*[ap]\.?m\b\.?)?/giu,
  /(?<![\p{N}])(?:19|20)\d{2}\s*[-–—/]\s*(?:(?:19|20)\d{2}|\d{2})(?![\p{N}])/gu,
]

/** A run of digits with the separators a written phone number uses. */
const PHONE_RUN = /(?<![\p{L}\p{N}+])[+(]?\d[\d ().-]*\d(?![\p{L}\p{N}])/gu

/**
 * Whether one run reads as a phone number, by shape:
 *
 * - international, `+` and a country code: 8 to 15 digits (+44 20 7946 0958);
 * - UK national, a leading 0: 10 or 11 digits (01234 567890, (01223) 123456);
 * - otherwise two or more groups of 2 to 5 digits split by single spaces or
 *   hyphens, 7 to 12 digits in all (555-1234), that are not all years.
 *
 * Times, prices and year ranges are removed before this is asked, so a
 * kitchen's hours or a "2026 - 2027" menu never count.
 */
function phoneShaped(run: string): boolean {
  const digits = run.replace(/\D/gu, "").length
  if (run.startsWith("+")) return digits >= 8 && digits <= 15
  if (/^\(?0/u.test(run)) return digits >= 10 && digits <= 11
  if (!/^\d+(?:[ -]\d+)+$/u.test(run)) return false
  const groups = run.split(/[ -]/u)
  return (
    digits >= 7 &&
    digits <= 12 &&
    groups.every((group) => group.length >= 2 && group.length <= 5) &&
    !groups.every((group) => /^(?:19|20)\d{2}$/u.test(group))
  )
}

export function containsPhoneNumber(body: string): boolean {
  const text = NOT_A_PHONE.reduce(
    (current, pattern) => current.replace(pattern, " x "),
    body
  )
  return [...text.matchAll(PHONE_RUN)].some(([match]) =>
    // A spaced dash or a double space separates two things, not the groups
    // of one number: "Tables for 2 - 01234 567890" is judged in parts.
    match
      .split(/\s+[-–]\s*|\s*[-–]\s+|\s{2,}/u)
      .some((part) => phoneShaped(part.trim()))
  )
}

/**
 * Top-level domains a link in pub and restaurant copy is likely to use. A
 * bare host must end in one of these, in lower case, so a missing space
 * between sentences ("Roast is back.Book now") is not taken for a link.
 */
const LINK_TLDS = [
  "co.uk",
  "org.uk",
  "com",
  "net",
  "org",
  "io",
  "co",
  "uk",
  "ie",
  "eu",
  "app",
  "dev",
  "info",
  "biz",
  "pub",
  "bar",
  "restaurant",
  "cafe",
  "menu",
  "online",
  "site",
  "shop",
  "london",
]

/** An explicit web address, in any case: http(s)://… or www.… */
const EXPLICIT_LINK = /https?:\/\/\S|(?<![\p{L}\p{N}.-])www\.[\p{L}\p{N}-]/iu

/** A bare host: dot-separated labels ending in a known domain, in lower case. */
const BARE_HOST = new RegExp(
  `(?<![\\p{L}\\p{N}.-])(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?\\.)+(?:${LINK_TLDS.map((tld) => tld.replace(".", "\\.")).join("|")})(?![\\p{L}\\p{N}-])`,
  "u"
)

/** A web address: http(s)://, www., or a host ending in a known domain. */
export function containsLink(body: string): boolean {
  return EXPLICIT_LINK.test(body) || BARE_HOST.test(body)
}
