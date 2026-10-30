// Adapted from OpenGMB packages/core/src/review-requests/pure.ts (gatingProblem)
// and packages/core/src/guardrails/review-request/gating.ts (GATING_RULES).
// Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited).

/**
 * The words printed with a venue's review QR code. Pure and client-safe:
 * the editor checks as the operator types and the server checks again
 * before saving.
 *
 * Google's "Prohibited and restricted content" policy for Maps
 * contributions (https://support.google.com/contributionpolicy/answer/7400114,
 * read 2026-10-27) says merchants may not "Discourage or prohibit negative
 * reviews, or selectively solicit positive reviews from customers", and
 * treats "Content that has been posted due to an incentive offered by a
 * business" and "Reviews or ratings that have been paid for, directly or in
 * kind" as fake engagement. Those are the conditional, discourage-negative
 * and incentive rules. The rating and stars rules go further than the
 * policy's words, on purpose: asking for a score, feedback or how the visit
 * went sorts happy guests from unhappy ones before the link, and asking for
 * five stars steers the answer. A caption may only ask for a Google review.
 */

export const REVIEW_LINK_CAPTION_MAX = 60
export const DEFAULT_REVIEW_LINK_CAPTION = "Leave us a review on Google"

export type ReviewLinkCaptionRuleId =
  | "CAPTION.length"
  | "CAPTION.conditional"
  | "CAPTION.rating"
  | "CAPTION.discourage-negative"
  | "CAPTION.incentive"
  | "CAPTION.stars"

export type ReviewLinkCaptionProblem = {
  ruleId: ReviewLinkCaptionRuleId
  message: string
  /** The words that triggered the rule, as written. */
  match: string
}

export type ReviewLinkCaptionCheck = {
  ok: boolean
  problems: ReviewLinkCaptionProblem[]
}

/** Characters that print as nothing: control and zero-width characters. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g

/**
 * Trimmed, one line, single spaces, compatibility forms folded (a
 * full-width "５" is a 5) and invisible characters removed, so what is
 * checked is what prints. Empty is no caption.
 */
export function normaliseReviewLinkCaption(
  text: string | null | undefined
): string | null {
  const caption = (text ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
  return caption === "" ? null : caption
}

type Rule = {
  id: Exclude<ReviewLinkCaptionRuleId, "CAPTION.length">
  message: string
  /** Whole words or phrases, matched case-insensitively. */
  lexicon: readonly string[]
  /** Symbols matched anywhere, with no word boundary (★ after a digit). */
  symbols?: readonly string[]
}

/** A short run of words inside a question ("Loved your Sunday roast?"). */
const FEW_WORDS = "(?: [\\p{L}\\p{N}’']+){0,3}"

const RULES: readonly Rule[] = [
  {
    id: "CAPTION.conditional",
    message:
      "This only asks guests who had a good time. Google doesn’t allow that: ask everyone the same way, for example “Leave us a review on Google”.",
    lexicon: [
      "if you (?:had|have|enjoyed|loved|liked) (?:a |an |your |our |the )?(?:good|great|positive|wonderful|excellent|amazing|lovely|pleasant|happy|nice|fantastic|brilliant|fab|fun)",
      "if you (?:enjoyed|loved|liked) (?:it|us|our|your|the|what|this|yourself|yourselves|everything)",
      "if you(?:’re|'re| are| were) (?:happy|satisfied|pleased|delighted|impressed|thrilled|glad)",
      "if (?:we|i) (?:did|made|were|was) (?:a )?(?:good|great|well|helpful|happy)",
      "if you (?:would|’d|'d) recommend us",
      "only (?:if|when) you(?:’re|'re| are| were)? (?:happy|satisfied|pleased)",
      "did you (?:enjoy|love|like)",
      // Question-led asks: "Loved it?", "Love us?", "Had a great night?",
      // "Happy with your meal?", "Enjoyed yourself?".
      `(?:enjoyed|loved|liked|enjoy|love)${FEW_WORDS}\\s*\\?`,
      "like us\\s*\\?",
      "(?:had|have) (?:a |an )?(?:good|great|lovely|nice|fun|fantastic|amazing|brilliant|fab|wonderful)[^?.!]{0,25}\\?",
      "had fun\\s*\\?",
      `(?:happy|satisfied|pleased)${FEW_WORDS}\\s*\\?`,
    ],
  },
  {
    id: "CAPTION.rating",
    message:
      "This asks for a rating, a score, feedback or how the visit went. Ask for a Google review only, and let the guest decide what to say.",
    lexicon: [
      "(?<!first[- ])rat(?:e|ing|ings)",
      "scores?",
      "out of (?:5|five|10|ten)",
      "on a scale",
      "(?:1|one) to (?:5|five|10|ten)",
      "surveys?",
      "questionnaires?",
      "polls?",
      "feedback",
      "how (?:was|were|did|is|are)",
      "how we did",
      "how we(?:’re|'re| are) doing",
    ],
  },
  {
    id: "CAPTION.discourage-negative",
    message:
      "This steers unhappy guests away from a public review, which Google doesn’t allow. Take it out and just ask for a review.",
    lexicon: [
      "(?:instead of|rather than) (?:leaving|posting|writing|giving|putting) (?:a |an |it )?(?:negative|bad|public|online|poor|low)",
      "before (?:you )?(?:post|posting|write|writing|review|reviewing|go online|going online|(?:leave|leaving) (?:a |your )?review)",
      "(?:please )?(?:do not|don’t|don't|dont) (?:leave|post|write) (?:a |an )?(?:negative|bad|poor|low)",
      "(?:contact|call|email|text|tell|talk to|speak to) us (?:first|before)",
      "(?:not |un)happy\\s*\\?",
      "if you(?:’re|'re| are| were) (?:not|unhappy|dissatisfied|disappointed|upset)",
      "if (?:anything|something) (?:went|was) wrong",
      "give us (?:a |the )?chance to (?:make it right|fix|put it right|resolve|correct)",
    ],
  },
  {
    id: "CAPTION.incentive",
    message:
      "This offers something in return for a review, such as a drink or a discount. Google doesn’t allow that: take the offer out and just ask.",
    lexicon: [
      "discounts?",
      "coupons?",
      "vouchers?",
      "gift (?:card|cards|certificate|certificates)",
      "in (?:exchange|return) for",
      "rewards?",
      "raffles?",
      "giveaways?",
      "sweepstakes?",
      "prizes?(?![- ]winning)",
      "prize draw",
      "(?:chance|opportunity) to win",
      "win (?:a|an|one|our|free|dinner|lunch)",
      "free (?:gift|meal|drink|drinks|pint|pints|coffee|starter|starters|dessert|desserts|pudding|item|round|bottle|glass|upgrade|night|dinner|lunch)",
      "complimentary",
      "half[- ]price",
      "(?:2|two) for (?:1|one)",
      "on us",
      "on the house",
      "(?:buy|get|give) you (?:a|an|one|your)",
      "\\d+ ?% off",
      "\\d+ percent off",
      "[£$€] ?\\d+ (?:off|credit|back)",
      "(?:store|account) credit",
      "loyalty points?",
      "cash ?back",
    ],
  },
  {
    id: "CAPTION.stars",
    message:
      "This asks for a particular rating, such as five stars. Ask for an honest review and let the guest choose.",
    lexicon: [
      "(?:\\d|one|two|three|four|five)[- ]?(?:stars?|★|⭐|☆|🌟|\\*)",
      "stars? (?:reviews?|ratings?)",
      "\\d ?/ ?(?:5|10)",
      "(?:top|perfect|highest|best|full) (?:rating|score|review|marks)",
      "(?:positive|glowing|good|great|nice|favorable|favourable|excellent|amazing|five[- ]star|5[- ]star) reviews?",
    ],
    symbols: ["★", "⭐", "☆", "🌟"],
  },
]

/** One case-insensitive pattern per rule: whole words, then bare symbols. */
const COMPILED = RULES.map((rule) => {
  const words = `(?<![\\p{L}\\p{N}])(?:${rule.lexicon.join("|")})(?![\\p{L}\\p{N}])`
  const symbols = rule.symbols?.length ? `|${rule.symbols.join("|")}` : ""
  return { rule, pattern: new RegExp(`${words}${symbols}`, "iu") }
})

const LENGTH_MESSAGE = `Keep it to ${REVIEW_LINK_CAPTION_MAX} characters, so it prints on no more than two lines under the code.`

export function checkReviewLinkCaption(text: string): ReviewLinkCaptionCheck {
  const caption = normaliseReviewLinkCaption(text) ?? ""
  const problems: ReviewLinkCaptionProblem[] = []
  if (caption.length > REVIEW_LINK_CAPTION_MAX) {
    problems.push({
      ruleId: "CAPTION.length",
      message: LENGTH_MESSAGE,
      match: caption.slice(REVIEW_LINK_CAPTION_MAX),
    })
  }
  for (const { rule, pattern } of COMPILED) {
    const found = pattern.exec(caption)
    if (found) {
      problems.push({ ruleId: rule.id, message: rule.message, match: found[0] })
    }
  }
  return { ok: problems.length === 0, problems }
}

/** The first problem's message, or null when the caption may be printed. */
export function reviewLinkCaptionProblem(text: string): string | null {
  return checkReviewLinkCaption(text).problems[0]?.message ?? null
}
