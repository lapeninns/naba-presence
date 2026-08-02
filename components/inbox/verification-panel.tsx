"use client"

import { useId } from "react"
import { CircleCheckIcon, ClockIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { LatestVerification } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

function verdictBadge(verdict: string | null | undefined): {
  label: string
  variant: "success" | "warning" | "destructive" | "secondary"
} {
  if (verdict === "pass") return { label: "Passed", variant: "success" }
  if (verdict === "warn") return { label: "Review needed", variant: "warning" }
  if (verdict === "fail") return { label: "Failed", variant: "destructive" }
  return { label: "Pending", variant: "secondary" }
}

const VERDICT_ICON = {
  pass: CircleCheckIcon,
  warn: TriangleAlertIcon,
  fail: OctagonXIcon,
  pending: ClockIcon,
} as const

function VerificationPanel({
  verification,
  status,
}: {
  verification: LatestVerification | null
  status: string
}) {
  const badge = verdictBadge(verification?.verdict)
  const reasons = verification?.reasons ?? []
  const verdict = verification?.verdict ?? "pending"
  const VerdictIcon = VERDICT_ICON[verdict as keyof typeof VERDICT_ICON] ?? ClockIcon
  // Unique per instance so the panel is safe to render more than once on a
  // page without a duplicate-id axe violation.
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-(--nr-radius-control) border border-border/60 bg-muted/40 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={headingId}
          className="flex items-center gap-1.5 text-ui font-semibold"
        >
          <VerdictIcon
            aria-hidden
            className={cn(
              "size-4",
              verdict === "pass" && "text-success",
              verdict === "warn" && "text-warning",
              verdict === "fail" && "text-destructive",
              verdict === "pending" && "text-muted-foreground"
            )}
          />
          Verification
        </h3>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {reasons.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {verification
            ? "No issues were found in this reply."
            : "Generate a draft to run verification."}
        </p>
      ) : (
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
              <span className="text-muted-foreground">{reason.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only">Workflow status: {status}.</p>
    </section>
  )
}

export { VerificationPanel, verdictBadge }
