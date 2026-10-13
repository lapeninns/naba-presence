"use client"

import { OutcomeSummary } from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { AdministrationAccessAttempt } from "@/lib/contracts/google-administration-attempt"
import type { AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { ACCESS_OPERATION_LABELS, reviewedRows } from "./access-review"
import { accessTargetDescription } from "./access-target"

/** What an independent read of Google showed about the requested access. */
function observedEffect(attempt: AdministrationAccessAttempt): string {
  switch (attempt.postcondition) {
    case "administrator_present":
      return attempt.pendingInvitation
        ? "Administrator invitation listed; access awaits acceptance"
        : "Administrator access listed"
    case "administrator_role_changed":
      return "Reviewed administrator role listed"
    case "administrator_absent":
      return "Reviewed administrator no longer listed"
    case "invitation_absent":
      return "Reviewed invitation no longer pending"
    case "account_access_present":
      return "Reviewed account and role independently accessible"
    case "unknown":
      return "The requested access change is not independently proven"
  }
}

export function AccessOutcome({
  attempt,
  review,
  busy,
  onCheck,
  onRefresh,
  onBack,
}: {
  attempt: AdministrationAccessAttempt
  review?: AdministrationAccessReview | null
  busy: boolean
  onCheck: () => void
  onRefresh: () => void
  onBack: () => void
}) {
  // Describe the target from the reviewed rows when this outcome's review is at
  // hand, otherwise from what Google listed when the outcome was observed.
  const rows = [
    ...(review?.changeSet.id === attempt.reviewId
      ? reviewedRows(review.changeSet.baseline)
      : []),
    ...(attempt.observation?.baseline.rows ?? []),
  ]
  return (
    <OutcomeSummary
      execution={attempt.executionState}
      confirmation={attempt.confirmationState}
      observedAt={attempt.observation?.observedAt ?? null}
      effect={observedEffect(attempt)}
      rows={[
        {
          label: "Action",
          value: ACCESS_OPERATION_LABELS[attempt.request.operation],
        },
        {
          label: "Google target",
          value: accessTargetDescription(attempt.request, rows),
        },
        { label: "Google reference", value: attempt.target, technical: true },
      ]}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCheck}>
            Read saved access outcome
          </Button>
          <Button
            variant="secondary"
            disabled={busy || attempt.executionState === "rejected"}
            onClick={onRefresh}
          >
            Refresh Google access state
          </Button>
          <Button
            variant="ghost"
            disabled={
              busy ||
              ["pending", "unresolved"].includes(attempt.confirmationState)
            }
            onClick={onBack}
          >
            Back to access
          </Button>
        </>
      }
    >
      {attempt.confirmationState === "unresolved" && (
        <p role="status" className="text-ui text-ink-secondary">
          Check Google state again. This saved request will not be sent again.
          Another write to this Google account is blocked until its outcome is
          resolved.
        </p>
      )}
      {attempt.error === "refresh_unavailable" && (
        <p role="alert" className="text-ui text-danger-ink">
          Google could not be read. The previous observation is retained with
          its original time.
        </p>
      )}
      {attempt.executionState === "rejected" && (
        <p className="text-ui text-ink-secondary">
          Google rejected this request. Check current access before reviewing a
          corrected request.
        </p>
      )}
    </OutcomeSummary>
  )
}
