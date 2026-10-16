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
 * The one workflow status, as a line of text with a glyph, on the publish
 * bar: ink words with the glyph and the words carrying the state, and the
 * note muted after them. No tint, no capsule, no five-stage rail.
 *
 * Caption size and at most two lines, so the docked bar on a phone stays one
 * row beside its button however long the note is.
 */
function ReplyStatusLine({
  status,
  onCharcoal = false,
  className,
}: {
  status: ReplyStatus
  /** The bar is the only form; kept so existing callers still compile. */
  variant?: "bar"
  /**
   * On the charcoal publish bar: the on-charcoal inks, which stay legible in
   * both themes (charcoal is near-white in the dark theme).
   */
  onCharcoal?: boolean
  className?: string
}) {
  const Icon = ICONS[status.icon]
  return (
    <span
      data-slot="reply-status"
      data-tone={status.tone}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-caption font-semibold",
        onCharcoal ? "text-ink-on-charcoal" : "text-ink",
        className
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          "size-4 shrink-0",
          status.icon === "loader" && "animate-spin motion-reduce:animate-none"
        )}
      />
      <span className="line-clamp-2 min-w-0">
        {status.text}
        {status.note ? (
          <span
            // On a phone the bar is one row beside its button, and the
            // sentence is what must read whole: a long note used to push it
            // into "Sent · waiting…". The note stays for screen readers and
            // from md up.
            className={cn(
              "font-normal max-md:sr-only",
              onCharcoal ? "text-ink-muted-on-charcoal" : "text-ink-muted"
            )}
          >
            {" "}
            · {status.note}
          </span>
        ) : null}
      </span>
    </span>
  )
}

export { ReplyStatusLine }
