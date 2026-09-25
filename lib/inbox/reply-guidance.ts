/**
 * Advice for the reply as it is being written: a few things a good reply to
 * this review usually does, ticked off live under the editor.
 *
 * It is guidance, not a gate. Nothing here blocks publishing — the server's
 * verification (`LatestVerification`) is the only check that can. Each item
 * is a plain fact about the text that the operator can see is true or not, so
 * a tick never claims more than it measured: there is deliberately no
 * "answers their point" item, because nothing on the wire says what the
 * point was.
 */

export type ReplyGuidanceId = "name" | "next-step" | "length"

export type ReplyGuidanceItem = {
  id: ReplyGuidanceId
  label: string
  met: boolean
}

/** Replies past this read as a letter rather than an answer. */
export const GUIDANCE_MAX_CHARS = 1000

// A low rating is a complaint; the reply should say how to take it further.
const NEXT_STEP_MAX_RATING = 3

const NEXT_STEP_PATTERN =
  /\b(call|phone|ring|email|e-mail|contact|get in touch|speak (to|with)|reach out|pop in|come back|put (it|this|things) right)\b/i

/**
 * The name a reply would greet them by: the first word of the display name,
 * when it looks like a name. Initials ("J."), handles with digits and
 * anonymous reviewers give nothing to check against.
 */
export function greetingName(
  displayName: string | null,
  isAnonymous: boolean
): string | null {
  if (isAnonymous || !displayName) return null
  const first = displayName.trim().split(/\s+/)[0] ?? ""
  if (first.length < 2 || /[\d@_]/.test(first) || /^\p{L}\.?$/u.test(first)) {
    return null
  }
  return first
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function mentionsName(body: string, name: string): boolean {
  // Letter boundaries rather than `\b`, which only knows ASCII: "Zoë" and
  // "José" are words too.
  return new RegExp(
    `(^|[^\\p{L}])${escapeRegExp(name)}($|[^\\p{L}])`,
    "iu"
  ).test(body)
}

export function replyGuidance({
  body,
  reviewerName,
  rating,
}: {
  body: string
  /** From `greetingName`; null leaves the name item out. */
  reviewerName: string | null
  rating: number | null
}): ReplyGuidanceItem[] {
  const text = body.trim()
  const items: ReplyGuidanceItem[] = []

  if (reviewerName) {
    items.push({
      id: "name",
      label: "Greets them by name",
      met: mentionsName(text, reviewerName),
    })
  }
  if (rating !== null && rating <= NEXT_STEP_MAX_RATING) {
    items.push({
      id: "next-step",
      label: "Offers a next step",
      met: NEXT_STEP_PATTERN.test(text),
    })
  }
  items.push({
    id: "length",
    label: `Under ${GUIDANCE_MAX_CHARS.toLocaleString("en-GB")} characters`,
    met: text.length > 0 && text.length <= GUIDANCE_MAX_CHARS,
  })

  return items
}
