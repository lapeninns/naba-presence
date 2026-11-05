import { InfoIcon, OctagonXIcon, ShieldCheckIcon } from "lucide-react"

import type { LatestVerification } from "@/lib/api/reviews"
import { describeOutcome } from "@/lib/editors/outcome"

/**
 * The server's checks on the reply as it stands, under the reply card. A
 * failed check is the only one that stops a publish: red, an alert, and the
 * field's description. A warning is a note that does not stop it. A pass is
 * ink, not green: green is kept for a reply Google shows, and passing the
 * checks only means a publish is possible.
 *
 * `verification` must be the verdict on the text in the box; the composer
 * drops it as soon as the text changes, so nothing here vouches for words
 * that were not checked.
 */
function ReplyChecks({
  verification,
  problemId,
}: {
  verification: LatestVerification | null
  /** The fail card's id, for the field's `aria-describedby`. */
  problemId: string
}) {
  if (!verification) return null

  if (verification.verdict === "fail") {
    const failing = verification.reasons.filter(
      (reason) => reason.severity === "fail"
    )
    return (
      <div
        id={problemId}
        role="alert"
        data-slot="reply-problem"
        data-verdict="fail"
        className="flex flex-col gap-1 rounded-(--np-radius-card) border border-danger-ink bg-danger-tint px-4 py-3"
      >
        <p className="m-0 flex items-center gap-2 text-ui font-semibold text-danger-ink">
          <OctagonXIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-4 shrink-0"
          />
          {describeOutcome("blocked").label}
        </p>{" "}
        <p className="m-0 text-caption text-ink">
          {failing.map((reason) => reason.message).join(" ")} Edit the reply and
          try again.
        </p>
      </div>
    )
  }

  if (verification.verdict === "warn") {
    const warnings = verification.reasons.filter(
      (reason) => reason.severity === "warn"
    )
    return (
      <div
        data-slot="reply-note"
        data-verdict="warn"
        className="flex flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3"
      >
        <p className="m-0 flex items-center gap-2 text-ui font-semibold text-ink">
          <InfoIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-4 shrink-0 text-warning-ink"
          />
          Checked with a note
        </p>
        {warnings.length > 0 ? (
          <p className="m-0 text-caption text-ink-secondary">
            {warnings.map((reason) => reason.message).join(" ")}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-slot="reply-checks"
      data-verdict="pass"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3"
    >
      <p className="m-0 flex items-center gap-2 text-ui font-semibold text-ink">
        <ShieldCheckIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0"
        />
        Checks passed
      </p>
      <p className="m-0 text-caption text-ink-muted">This version</p>
    </div>
  )
}

export { ReplyChecks }
