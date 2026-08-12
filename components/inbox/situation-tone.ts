import {
  CircleCheckIcon,
  CircleDashedIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import type { SituationTone } from "@/lib/inbox/review-situation"

/** Icons for situation tone — shared by list chips and the detail strip. */
export const SITUATION_TONE_ICON: Record<SituationTone, typeof CircleCheckIcon> = {
  positive: CircleCheckIcon,
  caution: TriangleAlertIcon,
  attention: OctagonXIcon,
  neutral: CircleDashedIcon,
}

// Chips (list status, live-reply disclosure) carry a full tint; they are small.
export const SITUATION_TONE_CHIP: Record<SituationTone, string> = {
  positive: "bg-success/10 text-success",
  // Measured AA choices, mirroring Badge: on a warning tint the readable text
  // colour is the plain foreground, not the amber itself.
  caution: "bg-warning/15 text-foreground",
  attention: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
}

// The status strip runs the full width of the pane, so a saturated fill on it
// shouts — and the calmest state ("all done") was shouting loudest. Urgency is
// carried by the icon and headline colour instead; only the two states that
// genuinely need attention also tint their background.
export const SITUATION_TONE_STRIP: Record<SituationTone, string> = {
  positive: "bg-muted/40 text-success",
  caution: "bg-warning/10 text-foreground",
  attention: "bg-destructive/10 text-destructive",
  neutral: "bg-muted/40 text-muted-foreground",
}
