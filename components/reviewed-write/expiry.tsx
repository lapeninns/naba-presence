import { cn } from "@/lib/utils"
import { Instant } from "./instant"

type ExpiryProps = {
  /** When the review (or, once approved, the approval) stops being valid. */
  readonly expiresAt: string
  /** Approved reviews talk about the approval; others about the review. */
  readonly approved: boolean
  /** The local clock has passed `expiresAt` (`useDeadline`). */
  readonly clockExpired: boolean
  /** The server refused the review as expired. */
  readonly reportedExpired?: boolean
  /**
   * When the server reported the expiry. Shown instead of `expiresAt` when the
   * server refused before the local clock got there, so the line never shows
   * a future-looking deadline for something already expired.
   */
  readonly reportedAt?: string | null
  readonly className?: string
}

/**
 * The one expiry line for a saved review:
 *   "Review expires 1 Oct 2026, 21:04."   (still open)
 *   "Approval expired 1 Oct 2026, 21:04." (the clock passed it)
 *   "Approval expired · checked 1 Oct …"  (the server said so first)
 *   "Approval has expired."               (the server said so; no time known)
 */
export function Expiry({
  expiresAt,
  approved,
  clockExpired,
  reportedExpired = false,
  reportedAt = null,
  className,
}: ExpiryProps) {
  const subject = approved ? "Approval" : "Review"
  const expired = clockExpired || reportedExpired
  // Words first, the time after them: a calm muted line while open; the
  // danger ink (and a heavier weight, not colour alone) once it has expired.
  const tone = expired
    ? "text-ui font-semibold text-danger-ink tabular-nums"
    : "text-ui text-ink-muted tabular-nums"
  if (clockExpired)
    return (
      <p data-slot="expiry" className={cn(tone, className)}>
        {subject} expired <Instant value={expiresAt} />.
      </p>
    )
  if (reportedExpired)
    return (
      <p data-slot="expiry" className={cn(tone, className)}>
        {reportedAt ? (
          <>
            {subject} expired · checked <Instant value={reportedAt} />
          </>
        ) : (
          `${subject} has expired.`
        )}
      </p>
    )
  return (
    <p data-slot="expiry" className={cn(tone, className)}>
      {subject} expires <Instant value={expiresAt} />.
    </p>
  )
}
