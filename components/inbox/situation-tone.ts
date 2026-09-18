import {
  CircleCheckIcon,
  CircleDashedIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import type { SituationTone } from "@/lib/inbox/review-situation"

/** Icons for a tone — shared by the status line and the live-reply disclosure. */
export const SITUATION_TONE_ICON: Record<SituationTone, typeof CircleCheckIcon> =
  {
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
 * draft yet", "Ready to publish", "Reply published" — is quiet ink, so the
 * three rows on screen that do need attention are the ones that get it.
 */
export const SITUATION_TONE_INK: Record<SituationTone, string> = {
  positive: "text-success-ink",
  caution: "text-warning-ink",
  attention: "text-danger-ink",
  neutral: "text-ink-muted",
}
