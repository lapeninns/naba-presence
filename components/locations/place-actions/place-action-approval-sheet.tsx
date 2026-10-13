"use client"

import { useState } from "react"

import {
  ChangeDiff,
  ReviewTime,
  outcomePhase,
} from "@/components/editors/change-diff"
import { SupportDetails } from "@/components/editors/support-details"
import { useVerificationExpiry } from "@/components/locations/administration/use-verification-expiry"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"

import type { usePlaceActionReview } from "./use-place-action-review"

type SheetAction = "approve" | "send" | "read" | "refresh"
type Workflow = ReturnType<typeof usePlaceActionReview>
type Outcome = NonNullable<Workflow["outcome"]>

function executionWords(state: Outcome["executionState"]): string {
  if (state === "accepted") return "Accepted by Google"
  if (state === "rejected") return "Rejected by Google"
  if (state === "pending") return "Request still in progress"
  return "Google acknowledgement unknown"
}

function confirmationWords(state: Outcome["confirmationState"]): string {
  if (state === "confirmed") return "Independently confirmed"
  if (state === "unrecorded") return "No independent confirmation recorded"
  if (state === "pending") return "Independent observation pending"
  return "Independent confirmation unresolved"
}

/**
 * The review → approve → consent → send sheet for one action link change.
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
  const expired = useVerificationExpiry(
    review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z"
  )
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
      field: "Action type",
      before: before ? actionTypeLabel(before.placeActionType) : "No action",
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
    <Sheet open={workflow.open} onOpenChange={workflow.setOpen}>
      <SheetContent side="right" size="wide" className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>
            {recorded
              ? "Saved action link outcome"
              : "Review action link change"}
          </SheetTitle>
          <SheetDescription>
            {recorded
              ? `Recorded request for the exact action link change to ${review.changeSet.locationName}. Nothing is sent again from here.`
              : `Exact action link change for ${review.changeSet.locationName}. Approval saves the request; sending is a separate action.`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <ChangeDiff
            rows={rows}
            caption={`Reviewed action link change for ${review.changeSet.locationName}`}
            phase={phase}
            confirmedAt={outcome?.observedAt}
          />
          {/* Google's resource names are for support, not for deciding. */}
          <SupportDetails
            items={[
              `Google target: ${review.target}`,
              request.operation !== "create"
                ? `Action link: ${request.name}`
                : null,
            ]}
          />
          {recorded || sending ? null : (
            <>
              <p className="text-caption text-ink-muted">
                {expired ? "Approval expired" : "Approval expires"}:{" "}
                <ReviewTime value={review.changeSet.expiresAt} />
              </p>
              {expired || workflow.stale ? (
                <p role="status" className="text-body text-ink">
                  This review needs a fresh preview before sending.
                </p>
              ) : null}
              {review.changeSet.requiresSecondApprover &&
              !review.changeSet.approvedBy ? (
                <p className="text-body text-ink">
                  A different current owner or administrator must approve this
                  exact change.
                </p>
              ) : null}
            </>
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
            <p role="status" className="text-body text-ink">
              The send response is unavailable. Read the saved outcome before
              another write.
            </p>
          ) : null}
          {outcome ? (
            <section
              aria-label="Action link request outcome"
              className="flex flex-col gap-2"
            >
              <p className="text-body text-ink">
                {executionWords(outcome.executionState)}
              </p>
              <p className="text-body text-ink">
                {confirmationWords(outcome.confirmationState)}
              </p>
              <p className="text-caption text-ink-muted">
                Observation:{" "}
                {outcome.observedAt ? (
                  <ReviewTime value={outcome.observedAt} />
                ) : (
                  "No dated observation recorded."
                )}
              </p>
            </section>
          ) : null}
          {workflow.error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {workflow.error}
            </p>
          ) : null}
          {review.changeSet.approvedBy && !outcome && !workflow.uncertain ? (
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              disabled={blocked}
              label="Send this exact approved action link change to Google."
            />
          ) : null}
        </SheetBody>
        <SheetFooter className="sm:items-center">
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
                Read saved action link outcome
              </Button>
              {canRefresh ? (
                <Button
                  variant="secondary"
                  disabled={workflow.busy}
                  pending={workflow.busy && action === "refresh"}
                  pendingLabel="Refreshing observation…"
                  onClick={act("refresh", () => workflow.check(true))}
                >
                  Refresh action link observation
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
              Send approved action link change
            </Button>
          ) : (
            <Button
              disabled={blocked || !review.changeSet.canApprove}
              pending={workflow.busy && action === "approve"}
              onClick={act("approve", workflow.approve)}
            >
              Approve action link change
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
