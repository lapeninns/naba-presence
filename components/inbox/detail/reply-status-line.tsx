import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CloudUploadIcon,
  LoaderIcon,
  LockIcon,
  PenLineIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { SITUATION_TONE_INK } from "@/components/inbox/situation-tone"
import type { ReplyStatus, ReplyStatusIcon } from "@/lib/inbox/reply-state"
import { cn } from "@/lib/utils"

const ICONS: Record<ReplyStatusIcon, typeof CheckIcon> = {
  loader: LoaderIcon,
  cloud: CloudUploadIcon,
  check: CheckIcon,
  "check-circle": CircleCheckIcon,
  clock: ClockIcon,
  alert: TriangleAlertIcon,
  pen: PenLineIcon,
  lock: LockIcon,
  circle: CircleDashedIcon,
}

/**
 * The one workflow status, as a line of text with a glyph.
 *
 * No tint, no capsule, no five-stage rail: an ordinary state is quiet ink, and
 * only the two exception tones carry colour. `variant="row"` is the short form
 * for a list row, `variant="detail"` the sentence for the pane — both from the
 * same `ReplyStatus`, so the queue and the pane always say the same thing.
 */
function ReplyStatusLine({
  status,
  variant = "detail",
  className,
}: {
  status: ReplyStatus
  /**
   * `bar` is the sentence on the charcoal action bar, where the tone inks
   * would not hold contrast: the words and the glyph carry the state.
   */
  variant?: "detail" | "row" | "bar"
  className?: string
}) {
  const Icon = ICONS[status.icon]
  const text = variant === "row" ? status.short : status.text
  return (
    <span
      data-slot="reply-status"
      data-tone={status.tone}
      // The full sentence is the accessible name even in a row, so a reader
      // hears "Ready to publish" rather than the abbreviation.
      aria-label={variant === "row" ? status.text : undefined}
      className={cn(
        variant === "bar"
          ? "inline-flex min-w-0 items-center gap-2.5 text-ui font-semibold text-ink-on-charcoal"
          : "inline-flex min-w-0 items-center gap-1.5 text-caption font-medium whitespace-nowrap",
        variant !== "bar" && SITUATION_TONE_INK[status.tone],
        className
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          variant === "bar" ? "size-4 shrink-0" : "size-3.5 shrink-0",
          status.icon === "loader" && "animate-spin"
        )}
      />
      <span className={variant === "row" ? "truncate" : undefined}>{text}</span>
    </span>
  )
}

export { ReplyStatusLine }
