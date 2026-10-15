"use client"

import { useState } from "react"

import { ChangeDiff, outcomePhase } from "@/components/editors/change-diff"
import { SupportDetails } from "@/components/editors/support-details"
import {
  ConsentSlot,
  Expiry,
  OutcomeSummary,
  ReviewedWriteSheet,
  reviewedWriteStage,
} from "@/components/reviewed-write"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import { useDeadline, useDeadlineWithin } from "@/lib/editors/use-deadline"

import type { usePlaceActionReview } from "./use-place-action-review"

type SheetAction = "approve" | "send" | "read" | "refresh"
type Workflow = ReturnType<typeof usePlaceActionReview>

/**
 * The review → approve → consent → send sheet for one booking link change.
 * Approval saves the exact request; sending is a separate, consented action.
 * An expired or stale review cannot send, and a recorded outcome is only
 * ever read back from here, never sent again.
 */
export function PlaceActionApprovalSheet({
  workflow,
  disabled,
}: {
  readonly workflow: Workflow
  readonly disabled: boolean
}) {
  const review = workflow.review
  const expiresAt = review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z"
  const expired = useDeadline(expiresAt)
  // The deadline is only worth a line once it is close: within the hour.
  const expiresSoon = useDeadlineWithin(expiresAt, 60 * 60_000)
  // Consent and the running action reset whenever the sheet, the review,
  // its approval, the workflow revision or the gate changes.
  const token = `${workflow.open}:${review?.changeSet.id}:${review?.changeSet.approvedBy}:${workflow.revision}:${disabled}`
  const [key, setKey] = useState(token)
  const [consent, setConsent] = useState(false)
  const [action, setAction] = useState<SheetAction | null>(null)
  if (key !== token) {
    setKey(token)
    setConsent(false)
    setAction(null)
  }
  if (!review) return null

  const request = review.request
  const baseline = placeActionBaselineSchema.safeParse(
    review.changeSet.baseline
  )
  const before =
    request.operation === "create"
      ? null
      : baseline.success
        ? baseline.data.links.find((link) => link.name === request.name)
        : null
  const after = request.operation === "delete" ? null : request.payload
  const phase = outcomePhase(
    workflow.outcome,
    workflow.uncertain,
    workflow.stale
  )
  // A confirmed removal is an observed state, not the proposed change.
  const removed = phase === "confirmed"
  const rows = [
    {
      field: "Link",
      before: before?.uri ?? "No link",
      after: after?.uri ?? (removed ? "Removed" : "Remove this link"),
    },
    {
      field: "Type",
      before: before ? actionTypeLabel(before.placeActionType) : "No link",
      after: after
        ? actionTypeLabel(after.placeActionType)
        : removed
          ? "Not listed"
          : "Removed",
    },
    {
      field: "Preferred",
      before: before?.isPreferred ? "Yes" : "No",
      after: after ? (after.isPreferred ? "Yes" : "No") : removed ? "—" : "No",
    },
  ]
  const blocked =
    disabled ||
    workflow.busy ||
    expired ||
    workflow.stale ||
    workflow.unresolved ||
    !baseline.success
  // A send marks the review uncertain before the response arrives; until it
  // settles this is still the review, not a lost response.
  const sending = workflow.busy && action === "send"
  // A busy sheet with no action of its own is reading a restored outcome.
  const reading = workflow.busy && (action === "read" || action === null)
  const recorded = Boolean(workflow.outcome || workflow.uncertain) && !sending
  const act = (next: SheetAction, work: () => void) => () => {
    setAction(next)
    work()
  }
  const outcome = workflow.outcome
  const canRefresh =
    outcome !== null &&
    outcome.executionState !== "rejected" &&
    outcome.confirmationState !== "confirmed"

  return (
    <ReviewedWriteSheet
      open={workflow.open}
      onOpenChange={workflow.setOpen}
      title={
        recorded ? "Saved booking link outcome" : "Review booking link change"
      }
      description={
        recorded
          ? `Recorded request for the exact booking link change to ${review.changeSet.locationName}. Nothing is sent again from here.`
          : `Exact booking link change for ${review.changeSet.locationName}. Approval saves the request; sending is a separate action.`
      }
      stage={reviewedWriteStage({
        approved: Boolean(review.changeSet.approvedBy),
        recorded,
      })}
      secondApprover={review.changeSet.requiresSecondApprover}
      footer={
        <>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            disabled={workflow.busy}
            onClick={() => workflow.setOpen(false)}
          >
            Keep editing
          </Button>
          {recorded ? (
            <>
              <Button
                variant="secondary"
                disabled={workflow.busy}
                pending={reading}
                pendingLabel="Reading saved outcome…"
                onClick={act("read", () => workflow.check())}
              >
                Read saved booking link outcome
              </Button>
              {canRefresh ? (
                <Button
                  variant="secondary"
                  disabled={workflow.busy}
                  pending={workflow.busy && action === "refresh"}
                  pendingLabel="Refreshing observation…"
                  onClick={act("refresh", () => workflow.check(true))}
                >
                  Refresh booking link observation
                </Button>
              ) : null}
            </>
          ) : review.changeSet.approvedBy ? (
            <Button
              disabled={blocked || !consent}
              pending={sending}
              pendingLabel="Sending…"
              onClick={act("send", workflow.send)}
            >
              Send approved booking link change
            </Button>
          ) : (
            <Button
              disabled={blocked || !review.changeSet.canApprove}
              pending={workflow.busy && action === "approve"}
              onClick={act("approve", workflow.approve)}
            >
              Approve booking link change
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <ChangeDiff
          rows={rows}
          caption={`Reviewed booking link change for ${review.changeSet.locationName}`}
          phase={phase}
          confirmedAt={outcome?.observedAt}
        />
        {/* Google's resource names are for support, not for deciding. */}
        <SupportDetails
          items={[
            `Google target: ${review.target}`,
            request.operation !== "create"
              ? `Booking link: ${request.name}`
              : null,
          ]}
        />
        {recorded || sending ? null : (
          <div className="flex min-w-0 flex-col gap-2">
            {expired || expiresSoon ? (
              <Expiry
                expiresAt={expiresAt}
                approved={Boolean(review.changeSet.approvedBy)}
                clockExpired={expired}
              />
            ) : null}
            {expired || workflow.stale ? (
              <Alert variant="warning">
                <AlertDescription>
                  This review needs a fresh preview before sending.
                </AlertDescription>
              </Alert>
            ) : null}
            {review.changeSet.requiresSecondApprover &&
            !review.changeSet.approvedBy ? (
              <p className="text-ui text-ink-muted">
                A different current owner or administrator must approve this
                exact change.
              </p>
            ) : null}
          </div>
        )}
        {reading && !recorded ? (
          <p role="status" className="text-ui text-ink-muted">
            Checking for a saved outcome…
          </p>
        ) : null}
        {sending ? (
          <p role="status" className="text-ui text-ink-muted">
            Sending to Google. The outcome appears here when the response
            arrives.
          </p>
        ) : null}
        {workflow.uncertain && !workflow.busy ? (
          <Alert variant="warning">
            <AlertDescription>
              The send response is unavailable. Read the saved outcome before
              another write.
            </AlertDescription>
          </Alert>
        ) : null}
        {outcome ? (
          <OutcomeSummary
            aria-label="Booking link request outcome"
            execution={outcome.executionState}
            confirmation={outcome.confirmationState}
            observedAt={outcome.observedAt}
          />
        ) : null}
        {workflow.error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {workflow.error}
          </p>
        ) : null}
        {review.changeSet.approvedBy && !outcome && !workflow.uncertain ? (
          <ConsentSlot
            label="Send this exact approved booking link change to Google."
            checked={consent}
            onCheckedChange={setConsent}
            disabled={blocked}
          />
        ) : null}
      </div>
    </ReviewedWriteSheet>
  )
}
