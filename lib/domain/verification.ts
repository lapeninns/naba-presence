import {
  bannedPhraseChecks,
  containsLink,
  containsPhoneNumber,
  replyRepetitionChecks,
} from "@/lib/domain/content-checks"
import { detectLanguage } from "@/lib/domain/language"
import { replyStyleChecks } from "@/lib/domain/reply-style"

/**
 * The rule checks on a reply (deterministic-v2). Each rule is here because
 * publishing text that breaks it would do harm; what each one guards:
 *
 *   empty_reply, reply_too_long   Google would refuse the reply.
 *   personal_contact_data         An email address, phone number or link in
 *                                 a public reply. Phone numbers are judged
 *                                 by shape (content-checks.ts), so a time, a
 *                                 price or a date is not one.
 *   forbidden_promotion           Google prohibits incentives in replies.
 *   unsupported_commitment        A refund or compensation the review never
 *                                 mentioned.
 *   unsafe_language               Profanity.
 *   asks_rating_change            Asking the guest to change or remove the
 *                                 review, or for a rating. Only a request
 *                                 aimed at their review counts: "thanks for
 *                                 the review, we have changed the menu" does
 *                                 not.
 *   wrong_location                Another venue of the same business named.
 *   third_person_summary,         The text is not a reply to the guest
 *   not_a_reply, placeholder_text (reply-style.ts).
 *   banned_phrase, reply_duplicate  The organisation's own policy; a copy of
 *                                 a recent reply.
 *
 * Notes (warn) never block: complaint_not_acknowledged, reply_long,
 * language_mismatch, stock_phrase, exclamation_overuse,
 * reply_repeated_opening.
 */
export const DETERMINISTIC_CHECKS_VERSION = "deterministic-v2"

const PROMOTION_ALLOWLIST =
  /\b[\w]+-free\b|\bfeel free\b|\bfree of charge\b|\bfree from\b/giu
/**
 * An incentive, not the word "free": a table that "was free" or a guest who
 * is "free to call" is not a promotion, a free drink is.
 */
const PROMOTION_ITEM =
  "(?:drinks?|pints?|rounds?|bottles?|glass(?:es)?|desserts?|puddings?|starters?|mains?|meals?|dinners?|lunch(?:es)?|breakfasts?|coffees?|sides?|gifts?|vouchers?|upgrades?|nights?|stays?|visits?)"
/**
 * "a free beer", "your free pizza": something offered free, whatever it is.
 * What follows must not be a thing that is merely unoccupied or spare.
 */
const OFFERED_FREE =
  "(?:a|an|your|some|another|one|two|2|the)\\s+free\\s+(?!tables?\\b|seats?\\b|spaces?\\b|spots?\\b|slots?\\b|rooms?\\b|moments?\\b|minutes?\\b|evenings?\\b|afternoons?\\b|hands?\\b|time\\b|parking\\b|house\\b|range\\b|to\\b|of\\b|from\\b|and\\b|for\\b|when\\b|at\\b|on\\b|in\\b)\\p{L}+"
const PROMOTION_PATTERN = new RegExp(
  `\\b(?:${OFFERED_FREE}|free\\s+${PROMOTION_ITEM}|${PROMOTION_ITEM}\\s+(?:is|are|will\\s+be)\\s+free|${PROMOTION_ITEM}\\s+(?:is|are|will\\s+be)\\s+on\\s+us|for free|on the house|complimentary|discount(?:s|ed)?|promo(?:tional)? code|vouchers?|coupons?|money off|bogo|(?:2|two)[-\\s]for[-\\s](?:1|one))\\b|\\d+\\s?% off\\b`,
  "iu"
)

export type VerificationReason = {
  code: string
  severity: "warn" | "fail"
  message: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Does the reply name this location, as a name rather than as a fragment of
 * one? `unique (organisation_id, name)` keeps sibling names distinct but lets
 * one contain another ("Lapen Inn" and "Lapen Inn Riverside"), and the
 * generation prompt invites the reply to name its own location — so a raw
 * `includes` reads every correct mention of the longer name as a mention of
 * the shorter one.
 */
function mentionsLocation(body: string, name: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
    "iu"
  ).test(body)
}

export function deterministicVerification(input: {
  body: string
  reviewText: string | null
  locationName: string
  otherLocationNames: string[]
  rating: number | null
  expectedLanguage?: string | null
  bannedPhrases?: readonly string[]
  recentPublishedReplies?: readonly string[]
  ratingOnlyTemplate?: boolean
}): VerificationReason[] {
  const reasons: VerificationReason[] = []
  const body = input.body.trim()
  const reviewLower = input.reviewText?.toLowerCase() ?? ""
  const add = (code: string, severity: "warn" | "fail", message: string) =>
    reasons.push({ code, severity, message })

  if (!body) add("empty_reply", "fail", "The reply is empty.")
  if (Buffer.byteLength(body, "utf8") > 4096) {
    add(
      "reply_too_long",
      "fail",
      "The reply exceeds Google’s 4,096-byte limit."
    )
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(body) ||
    containsPhoneNumber(body) ||
    // Shapes the shared helper leaves to post copy: a bracketed area code
    // ("(415) 555-2671") and ten or eleven digits run together.
    /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}(?!\d)/u.test(body) ||
    /(?<![\p{L}\p{N}£$€.,:])\d{10,11}(?![\p{L}\p{N}]|[.,:]\d)/u.test(body) ||
    containsLink(body)
  ) {
    add(
      "personal_contact_data",
      "fail",
      "The reply contains an email address, phone number or link. Remove it and ask the guest to get in touch with the venue directly."
    )
  }
  const promotionCandidate = body.replace(PROMOTION_ALLOWLIST, " ")
  if (PROMOTION_PATTERN.test(promotionCandidate)) {
    add(
      "forbidden_promotion",
      "fail",
      "The reply offers a promotion or incentive, which Google does not allow in a review reply. Remove it."
    )
  }
  if (
    /\b(refund(?:ed)?|reimburse(?:d)?|compensat(?:e|ed|ion)|guarantee(?:d)?)\b/iu.test(
      body
    ) &&
    !/\b(refund|reimburse|compensat|guarantee)\b/iu.test(reviewLower)
  ) {
    add(
      "unsupported_commitment",
      "fail",
      "The reply mentions a refund, compensation or guarantee that the review does not. Remove it."
    )
  }
  if (/\b(fuck|shit|bitch|bastard)\b/iu.test(body)) {
    add(
      "unsafe_language",
      "fail",
      "The reply contains language that is not fit to publish. Remove it."
    )
  }
  // Google review policy: a reply never asks the guest to change or remove
  // the review, or for a rating. Only a request aimed at THEIR review counts;
  // "thanks for the review, we have changed the menu" is not one.
  const REVIEW_NOUN = "(?:review|rating|stars?|score)"
  if (
    new RegExp(
      `\\b(?:update|updating|edit|editing|change|changing|revise|revising|amend|amending|reconsider|reconsidering|remove|removing|delete|deleting|withdraw|withdrawing|take\\s+down|taking\\s+down|raise|raising|increase|increasing|improve|improving)\\s+(?:your|the|this|that)\\s+(?:\\w+\\s+){0,2}${REVIEW_NOUN}\\b`,
      "iu"
    ).test(body) ||
    /\b(?:leave|give|post|write)\s+(?:us\s+)?(?:a\s+|another\s+)?(?:(?:5|five)[-\s]?star|positive|good|great|better|new|updated)\s+(?:review|rating)\b/iu.test(
      body
    ) ||
    /\b(?:review|rating)\s+(?:could|can|might|may|to)\s+be\s+(?:updated|changed|revised|amended|removed|deleted|reconsidered|withdrawn)\b/iu.test(
      body
    )
  ) {
    add(
      "asks_rating_change",
      "fail",
      "The reply asks the guest to change or remove their review, or to leave a rating. Google does not allow this. Remove the request."
    )
  }
  // A sibling whose name is contained in this location's own name is matched
  // by every reply that correctly names the location it belongs to, so it can
  // never be evidence of the wrong one. Drop those first, then require a real
  // name boundary: this check promotes the whole verdict to `fail` and blocks
  // publishing, so it must not fire on a reply that is right.
  const ownName = input.locationName.toLowerCase()
  const wrongLocation = input.otherLocationNames.find((name) => {
    const candidate = name.toLowerCase()
    return (
      candidate !== ownName &&
      name.length > 3 &&
      !ownName.includes(candidate) &&
      mentionsLocation(body, name)
    )
  })
  if (wrongLocation) {
    add(
      "wrong_location",
      "fail",
      `The reply mentions a different location: ${wrongLocation}.`
    )
  }
  if (
    input.rating !== null &&
    input.rating <= 2 &&
    !/\b(?:sorry|apolog\w*|regret\w*|disappoint\w*|not good enough|fell short|falls short|let you down|should not have|shouldn(?:'|’)t have|wasn(?:'|’)t (?:right|good enough|acceptable)|unacceptable)\b/iu.test(
      body
    )
  ) {
    add(
      "complaint_not_acknowledged",
      "warn",
      "This is a low rating and the reply does not acknowledge that something went wrong."
    )
  }
  if (body.length > 1000) {
    add(
      "reply_long",
      "warn",
      "The reply is long for a public review reply. Shorter usually reads better."
    )
  }
  const expectedLanguage = input.expectedLanguage
  const nonLatinLanguage =
    expectedLanguage === "ar" ||
    expectedLanguage === "ru" ||
    expectedLanguage === "ja" ||
    expectedLanguage === "hi"
  const detectedLanguage =
    expectedLanguage && expectedLanguage !== "en" && !nonLatinLanguage
      ? detectLanguage(body)
      : null
  if (
    (nonLatinLanguage && /^[\p{ASCII}\s\p{Punctuation}]+$/u.test(body)) ||
    (detectedLanguage &&
      (detectedLanguage.confidence ?? 0) >= 0.7 &&
      detectedLanguage.code !== expectedLanguage)
  ) {
    add(
      "language_mismatch",
      "warn",
      "The reply may not match the expected review language."
    )
  }
  return [
    ...reasons,
    ...replyStyleChecks(body),
    ...bannedPhraseChecks(body, input.bannedPhrases ?? []),
    ...replyRepetitionChecks({
      body,
      recentPublishedReplies: input.recentPublishedReplies ?? [],
      ratingOnlyTemplate: input.ratingOnlyTemplate,
    }),
  ]
}

export function verificationVerdict(
  reasons: VerificationReason[]
): "pass" | "warn" | "fail" {
  return reasons.some((reason) => reason.severity === "fail")
    ? "fail"
    : reasons.length
      ? "warn"
      : "pass"
}
