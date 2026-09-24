import {
  CircleCheckIcon,
  CircleDashedIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import type { ReplyStatus } from "@/lib/inbox/reply-state"
import type { SituationTone } from "@/lib/inbox/review-situation"

/** Icons for a tone — shared by the status line and the live-reply disclosure. */
export const SITUATION_TONE_ICON: Record<
  SituationTone,
  typeof CircleCheckIcon
> = {
  positive: CircleCheckIcon,
  caution: TriangleAlertIcon,
  attention: OctagonXIcon,
  neutral: CircleDashedIcon,
}

/**
 * The tone's ink, for text that sits on the surface rather than on a tint.
 *
 * There is no tint or capsule map any more. The Inbox spends strong colour on
 * the primary action and on the two exception tones; an ordinary status — "No
 * reply yet", "Ready to publish", "Live on Google" — is quiet ink, so the
 * three rows on screen that do need attention are the ones that get it.
 */
export const SITUATION_TONE_INK: Record<SituationTone, string> = {
  positive: "text-success-ink",
  caution: "text-warning-ink",
  attention: "text-danger-ink",
  neutral: "text-ink-muted",
}

/**
 * A reply status as a list-row pill (reference `.pill`): the tone the words
 * already carry, with two refinements the tone scale cannot express — a
 * checked draft that may go out is the accent ("Draft ready"), and work
 * that is with Google but not yet confirmed is info. A review with nothing
 * written yet is a dashed "not yet" pill. "Replied" is `ok` only because the
 * ladder reaches it from a confirmed `published` status and nothing else.
 */
export function replyStatusPill(status: ReplyStatus): {
  tone: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"
  dashed: boolean
} {
  if (status.tone === "attention") return { tone: "bad", dashed: false }
  if (status.tone === "caution") return { tone: "warn", dashed: false }
  if (status.tone === "positive") return { tone: "ok", dashed: false }
  if (status.icon === "cloud" || status.icon === "loader") {
    return { tone: "info", dashed: false }
  }
  if (status.text === "Live on Google") return { tone: "ok", dashed: false }
  if (status.icon === "check") return { tone: "accent", dashed: false }
  if (status.short === "Needs reply") return { tone: "neutral", dashed: true }
  return { tone: "neutral", dashed: false }
}
