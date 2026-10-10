import { ReviewTime } from "@/components/editors/change-diff"

type ReviewExpiryInput = {
  readonly expiresAt: string
  readonly approved: boolean
  readonly clockExpired: boolean
  readonly reportedExpired?: boolean
}

/**
 * The expiry line for an exact saved review. An approved review states when
 * its approval expires; an unapproved one states when the review expires.
 * Once expired it says so in the past tense, and never shows a future-looking
 * time: a server-reported expiry before the recorded deadline omits the time.
 */
export function reviewExpiryText({
  expiresAt,
  approved,
  clockExpired,
  reportedExpired = false,
}: ReviewExpiryInput): string {
  const subject = approved ? "Approval" : "Review"
  const time = new Date(expiresAt).toLocaleString("en-GB")
  if (clockExpired) return `${subject} expired at ${time}.`
  if (reportedExpired) return `${subject} has expired.`
  return `${subject} expires ${time}.`
}

/**
 * The same expiry state split into a lead phrase and the instant to show, so
 * a caller can render the instant as a local `<time>` (see `ReviewTime`).
 * `instant` is null when the time must not be shown (a server-reported expiry
 * before the recorded deadline).
 */
export function reviewExpiryParts({
  expiresAt,
  approved,
  clockExpired,
  reportedExpired = false,
}: ReviewExpiryInput): { readonly lead: string; readonly instant: string | null; readonly expired: boolean } {
  const subject = approved ? "Approval" : "Review"
  if (clockExpired) return { lead: `${subject} expired`, instant: expiresAt, expired: true }
  if (reportedExpired) return { lead: `${subject} has expired`, instant: null, expired: true }
  return { lead: `${subject} expires`, instant: expiresAt, expired: false }
}

export function ReviewExpiry(
  props: ReviewExpiryInput & {
    readonly className?: string
    /**
     * "instant" renders the time in the viewer's local zone via `ReviewTime`,
     * keeping the raw value in `dateTime`/`title`. Defaults to the original
     * text rendering.
     */
    readonly format?: "text" | "instant"
  }
) {
  const className = props.className ?? "font-mono text-caption text-ink-muted"
  if (props.format !== "instant") return <p className={className}>{reviewExpiryText(props)}</p>
  const parts = reviewExpiryParts(props)
  return (
    <p className={className}>
      {parts.lead}
      {parts.instant ? <> <ReviewTime value={parts.instant} /></> : null}.
    </p>
  )
}
