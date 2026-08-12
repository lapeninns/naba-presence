"use client"

import { useId } from "react"
import { CircleCheckIcon, ClockIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

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
  pass: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
  pending: "text-muted-foreground",
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
  const VerdictIcon = VERDICT_ICON[verdict as keyof typeof VERDICT_ICON] ?? ClockIcon
  // Unique per instance so the panel is safe to render more than once on a
  // page without a duplicate-id axe violation.
  const headingId = useId()

  const heading = (
    <div className="flex flex-wrap items-center gap-2">
      <VerdictIcon
        aria-hidden
        className={cn("size-4 shrink-0", VERDICT_ICON_TONE[verdict])}
      />
      <h3 id={headingId} className="text-ui font-semibold">
        Verification
      </h3>
    </div>
  )

  if (reasons.length === 0) {
    return (
      <section aria-labelledby={headingId} className="flex flex-wrap items-center gap-2">
        {heading}
        <p className="text-caption text-muted-foreground">
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
        "flex flex-col gap-2 rounded-(--nr-radius-control) border p-3",
        blocking
          ? "border-destructive/30 bg-destructive/5"
          : "border-warning/40 bg-warning/10"
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
              className="shrink-0"
            >
              {reason.severity === "fail" ? "Blocking" : "Warning"}
            </Badge>
            <span className="text-foreground/80">{reason.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export { VerificationPanel }
