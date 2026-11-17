import type { VerificationReason } from "@/lib/domain/verification"

/**
 * Checks on how a reply reads, as plain facts about its text: it describes
 * the guest in the third person, it still holds a placeholder, it leans on a
 * stock phrase. Each message quotes what was found and says what to do.
 *
 * Severity follows what publishing the text would do. A reply that talks
 * about "the reviewer", or that still says "[Name]", is not a reply and
 * fails. A stock phrase or a run of exclamation marks is poor writing that a
 * person may still choose to publish, so it is a note; a generated reply is
 * rewritten once to clear it (lib/domain/reply-pipeline.ts).
 */

/** Comparison form: lower case, straight apostrophes, single spaces. */
function plain(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
}

const THIRD_PERSON_PATTERNS = [
  /\b(?:the|this) reviewer\b/iu,
  /\b(?:the|this) review (?:says|states|mentions|describes|notes|indicates|praises|complains|is|was)\b/iu,
  /\bthe (?:customer|guest|user|author|diner|patron) (?:says|said|mentions|mentioned|states|stated|notes|noted|enjoyed|enjoys|liked|loved|praised|complains|complained|reports|reported|feels|felt|writes|wrote|is|was|has|had|continues|will|would|visited|experienced|expressed|appreciated)\b/iu,
]

const META_PATTERNS = [
  /\bas an ai\b/iu,
  /\b(?:language|ai) model\b/iu,
  /^\s*(?:here(?:'|’)?s|here is) (?:a|the|your|my) (?:draft|reply|response|suggested)/iu,
  /^\s*(?:draft|suggested|proposed) (?:reply|response)\s*:/iu,
  /^\s*(?:reply|response)\s*:/iu,
]

/** A bracketed slot a template or a model left unfilled. */
const PLACEHOLDER_PATTERN =
  /\[[^\]\n]{0,40}(?:name|reviewer|customer|guest|venue|restaurant|pub|business|location|manager|your |insert|contact|phone|email|dish|staff|date)[^\]\n]{0,40}\]|\{\{?\s*[\w .-]{1,40}\s*\}?\}|<\s*(?:name|reviewer|customer|venue|manager|contact)[^>\n]{0,30}>/iu

/**
 * Phrases that mark a reply as written by rote. Matched on the plain form,
 * so curly and straight apostrophes and case do not matter.
 */
const STOCK_PHRASES: { pattern: RegExp; phrase: string }[] = [
  {
    pattern:
      /\bwe (?:really |truly |greatly |sincerely )?appreciate your (?:support|feedback|patronage|business|kind words)\b/u,
    phrase: "We appreciate your support",
  },
  {
    pattern:
      /\b(?:we (?:truly |really |greatly )?value your (?:feedback|opinion|input|support)|your feedback is (?:very |extremely |so )?(?:important|valuable|invaluable)(?: to us)?)\b/u,
    phrase: "We value your feedback",
  },
  {
    pattern: /\bthank you (?:so much |very much )?for taking the time to\b/u,
    phrase: "Thank you for taking the time to",
  },
  {
    pattern:
      /\bwe (?:hope|look forward) to (?:welcom(?:e|ing)|see(?:ing)?|serv(?:e|ing)) you (?:back |again )+(?:very )?soon\b/u,
    phrase: "We hope to welcome you back soon",
  },
  {
    pattern: /\bwe (?:always |constantly |continually )?strive to\b/u,
    phrase: "We strive to",
  },
  {
    pattern:
      /\bthank you (?:so much |very much )?for (?:your kind words|bringing this to our attention)\b/u,
    phrase: "Thank you for your kind words",
  },
  {
    pattern: /\bwe pride ourselves on\b/u,
    phrase: "We pride ourselves on",
  },
  {
    pattern:
      /\bmeans? (?:the world|so much|a great deal|a lot) to (?:us|our team|the team)\b/u,
    phrase: "means the world to us",
  },
  {
    pattern:
      /\bwe(?:'re| are) (?:absolutely |so |truly |really )?(?:thrilled|delighted|overjoyed|ecstatic) (?:to hear|that you)\b/u,
    phrase: "We are thrilled to hear",
  },
  {
    pattern: /\b(?:valued|loyal) (?:customer|guest|patron)s?\b/u,
    phrase: "valued customer",
  },
  {
    pattern: /\bwe apologi[sz]e for any inconvenience\b/u,
    phrase: "We apologise for any inconvenience",
  },
]

/** The stock phrases a text uses, as they are named to the person. */
export function stockPhrasesIn(body: string): string[] {
  const text = plain(body)
  return STOCK_PHRASES.flatMap(({ pattern, phrase }) =>
    pattern.test(text) ? [phrase] : []
  )
}

export function describesGuestInThirdPerson(body: string): boolean {
  return THIRD_PERSON_PATTERNS.some((pattern) => pattern.test(body))
}

export function replyStyleChecks(body: string): VerificationReason[] {
  const reasons: VerificationReason[] = []
  const text = body.trim()
  if (!text) return reasons

  if (describesGuestInThirdPerson(text)) {
    reasons.push({
      code: "third_person_summary",
      severity: "fail",
      message:
        "The reply talks about the guest instead of to them (for example “the reviewer”). Rewrite it to address them as “you”.",
    })
  }
  if (META_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push({
      code: "not_a_reply",
      severity: "fail",
      message:
        "The text reads as a note about a reply, not the reply itself. Keep only the words meant for the guest.",
    })
  }
  const placeholder = text.match(PLACEHOLDER_PATTERN)?.[0]
  if (placeholder) {
    reasons.push({
      code: "placeholder_text",
      severity: "fail",
      message: `The reply still contains a placeholder (“${placeholder}”). Replace it or remove it.`,
    })
  }
  const stock = stockPhrasesIn(text)
  if (stock.length) {
    reasons.push({
      code: "stock_phrase",
      severity: "warn",
      message: `The reply uses a stock phrase (${stock.map((phrase) => `“${phrase}”`).join(", ")}). Say something specific to this review instead.`,
    })
  }
  if ((text.match(/!/gu)?.length ?? 0) > 1) {
    reasons.push({
      code: "exclamation_overuse",
      severity: "warn",
      message:
        "The reply uses more than one exclamation mark. One at most reads better.",
    })
  }
  return reasons
}
