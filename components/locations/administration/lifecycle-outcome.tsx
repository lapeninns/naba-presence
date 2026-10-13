"use client"

import { OutcomeSummary, ReviewedWritePanel } from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { LifecycleAttempt } from "@/lib/contracts/google-lifecycle-review"
import type { useLifecycle } from "./use-lifecycle"

/** What an independent read of Google showed after the lifecycle request. */
function observedEffect(attempt: LifecycleAttempt): string {
  if (attempt.postcondition === "location_transferred_between_accounts")
    return "The exact location was observed in the destination account and absent from the source account."
  if (attempt.postcondition === "location_absent_from_managed_account")
    return "The managed location was absent from the source account, and an independent location read returned not found. Search/Maps removal and customer-review deletion are not confirmed."
  return "The intended lifecycle outcome has not been independently established. Check the saved outcome before another write."
}

function reconciliationText(attempt: LifecycleAttempt): string {
  if (attempt.localReconciliation === "applied")
    return "NabaPresence is linked to the independently confirmed destination account."
  if (attempt.localReconciliation === "conflict")
    return "The local account link changed. An operational check is required before reconciling the saved transfer."
  if (attempt.localReconciliation === "not_required")
    return "The local account link has not been changed by this request."
  return "Local account reconciliation is pending. Refresh the independent observation to check the original transfer."
}

export function LifecycleOutcome({
  workflow,
  focusKey,
}: {
  readonly workflow: ReturnType<typeof useLifecycle>
  readonly focusKey?: string | null
}) {
  const attempt = workflow.attempt
  if (!attempt) return null
  const transfer = attempt.request.operation === "transfer_location"
  return (
    <ReviewedWritePanel
      id="lifecycle-outcome-title"
      tone="danger"
      title="Saved lifecycle outcome"
      stage="outcome"
      focusKey={focusKey}
    >
      <OutcomeSummary
        execution={attempt.executionState}
        confirmation={attempt.confirmationState}
        observedAt={attempt.observedAt}
        effect={observedEffect(attempt)}
        rows={[
          {
            label: "Request",
            value: transfer ? "Account transfer" : "Managed-location deletion",
          },
          ...(attempt.request.operation === "transfer_location"
            ? [
                {
                  label: "Reviewed destination",
                  value: attempt.request.payload.destinationAccount,
                },
              ]
            : []),
          { label: "Google location", value: attempt.target, technical: true },
          {
            label: "Source account",
            value: attempt.sourceAccount,
            technical: true,
          },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={workflow.busy}
              onClick={() => workflow.check()}
            >
              Read saved lifecycle outcome
            </Button>
            <Button
              variant="secondary"
              disabled={workflow.busy}
              onClick={() => workflow.check(true)}
            >
              Refresh lifecycle observation
            </Button>
            <Button
              variant="ghost"
              disabled={workflow.busy || workflow.unresolved}
              onClick={workflow.reset}
            >
              Review another lifecycle action
            </Button>
          </>
        }
      >
        {transfer ? (
          <p className="text-ui text-ink-secondary">
            {reconciliationText(attempt)}
          </p>
        ) : null}
      </OutcomeSummary>
    </ReviewedWritePanel>
  )
}
