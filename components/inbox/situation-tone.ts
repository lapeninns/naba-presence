import {
  CircleCheckIcon,
  CircleDashedIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import type { SituationTone } from "@/lib/inbox/review-situation"
import type { StatusTone } from "@/lib/ui/status-tone"

/** Icons for situation tone — shared by list chips and the detail strip. */
export const SITUATION_TONE_ICON: Record<SituationTone, typeof CircleCheckIcon> = {
  positive: CircleCheckIcon,
  caution: TriangleAlertIcon,
  attention: OctagonXIcon,
  neutral: CircleDashedIcon,
}

/**
 * The situation tone as the product-wide status vocabulary, so a list row can
 * draw the same dot the shell's health chip and the client list draw.
 */
export const SITUATION_TONE_STATUS: Record<SituationTone, StatusTone> = {
  positive: "healthy",
  caution: "attention",
  attention: "at-risk",
  neutral: "neutral",
}

/** The tone's ink alone, for text that sits on the surface rather than a tint. */
export const SITUATION_TONE_INK: Record<SituationTone, string> = {
  positive: "text-success-ink",
  caution: "text-warning-ink",
  attention: "text-danger-ink",
  neutral: "text-ink-muted",
}

// Chips (live-reply disclosure) carry the status tint with its measured ink.
export const SITUATION_TONE_CHIP: Record<SituationTone, string> = {
  positive: "bg-success-tint text-success-ink",
  caution: "bg-warning-tint text-warning-ink",
  attention: "bg-danger-tint text-danger-ink",
  neutral: "bg-fill text-ink-muted",
}

// The status strip runs the full width of the pane. The tints are light
// enough that even the calm states can carry one without shouting; urgency
// is in the icon and the headline ink.
export const SITUATION_TONE_STRIP: Record<SituationTone, string> = {
  positive: "bg-success-tint text-success-ink",
  caution: "bg-warning-tint text-warning-ink",
  attention: "bg-danger-tint text-danger-ink",
  neutral: "bg-fill text-ink-muted",
}
