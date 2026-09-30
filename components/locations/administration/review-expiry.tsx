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
}: {
  readonly expiresAt: string
  readonly approved: boolean
  readonly clockExpired: boolean
  readonly reportedExpired?: boolean
}): string {
  const subject = approved ? "Approval" : "Review"
  const time = new Date(expiresAt).toLocaleString("en-GB")
  if (clockExpired) return `${subject} expired at ${time}.`
  if (reportedExpired) return `${subject} has expired.`
  return `${subject} expires ${time}.`
}

export function ReviewExpiry(
  props: Parameters<typeof reviewExpiryText>[0] & {
    readonly className?: string
  }
) {
  return (
    <p className={props.className ?? "font-mono text-caption text-ink-muted"}>
      {reviewExpiryText(props)}
    </p>
  )
}
