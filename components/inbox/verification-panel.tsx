"use client"

import { useId } from "react"
import {
  CircleCheckIcon,
  ClockIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { LatestVerification } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

const VERDICT_ICON = {
  pass: CircleCheckIcon,
  warn: TriangleAlertIcon,
  fail: OctagonXIcon,
  pending: ClockIcon,
} as const

const VERDICT_ICON_TONE: Record<string, string> = {
  pass: "text-success-ink",
  warn: "text-warning-ink",
  fail: "text-danger-ink",
  pending: "text-ink-muted",
}

/**
 * "Nothing is wrong" deserves one quiet line; "something is wrong" deserves a
 * box you cannot miss. The old panel spent the same full-width bordered card
 * on both, so a clean pass looked exactly as urgent as a blocking failure.
 *
 * The situation strip already names the state ("Ready to publish", "Blocked
 * by verification"), so this panel does not repeat a verdict badge — it only
 * lists the reasons that need attention.
 */
function VerificationPanel({
  verification,
  status,
}: {
  verification: LatestVerification | null
  status: string
}) {
  const reasons = verification?.reasons ?? []
  const verdict = verification?.verdict ?? "pending"
  const VerdictIcon =
    VERDICT_ICON[verdict as keyof typeof VERDICT_ICON] ?? ClockIcon
  // Unique per instance so the panel is safe to render more than once on a
  // page without a duplicate-id axe violation.
  const headingId = useId()

  const heading = (
    <div className="flex flex-wrap items-center gap-2">
      <VerdictIcon
        aria-hidden
        strokeWidth={1.75}
        className={cn("size-4 shrink-0", VERDICT_ICON_TONE[verdict])}
      />
      <h3 id={headingId} className="text-ui font-semibold text-ink">
        Verification
      </h3>
    </div>
  )

  if (reasons.length === 0) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-wrap items-center gap-2"
      >
        {heading}
        <p className="text-caption text-ink-muted">
          {verification
            ? "No issues found in this reply."
            : status === "new"
              ? "Runs as soon as you save a draft."
              : "Not run yet."}
        </p>
      </section>
    )
  }

  const blocking = reasons.some((reason) => reason.severity === "fail")

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-2 rounded-(--np-radius-control) p-3",
        blocking ? "bg-danger-tint" : "bg-warning-tint"
      )}
    >
      {heading}
      <ul className="flex flex-col gap-1.5">
        {reasons.map((reason, index) => (
          <li
            key={`${reason.code}-${index}`}
            className="flex items-start gap-2 text-caption"
          >
            <Badge
              variant={reason.severity === "fail" ? "destructive" : "warning"}
              shape="tag"
              className="shrink-0"
            >
              {reason.severity === "fail" ? "Blocking" : "Warning"}
            </Badge>
            <span className="pt-0.5 text-ink">{reason.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export { VerificationPanel }
