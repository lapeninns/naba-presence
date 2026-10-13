"use client"

import { useState } from "react"
import {
  ChangeDiff,
  outcomePhase,
  type ChangeRow,
} from "@/components/editors/change-diff"
import {
  ConsentSlot,
  Expiry,
  OutcomeSummary,
  ReviewedWriteSheet,
  SummaryList,
  reviewedWriteStage,
  type ConfirmationState,
  type ExecutionState,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { useDeadline } from "@/lib/editors/use-deadline"

/**
 * What a reviewed Google change workflow (use-lodging-review,
 * use-service-review) exposes to its sheet. The hooks stay separate: they
 * differ in restore, 404 and toast handling.
 */
export type ReviewedChangeWorkflow = {
  readonly review: GbpChangeSet | null
  readonly outcome: {
    readonly executionState: ExecutionState
    readonly confirmationState: ConfirmationState
    readonly observedAt?: string | null
  } | null
  readonly busy: boolean
  readonly error: string | null
  readonly open: boolean
  readonly uncertain: boolean
  readonly unresolved: boolean
  readonly stale: boolean
  readonly selectionRevision: number
  readonly approve: () => void
  readonly send: () => void
  readonly check: (refresh?: boolean) => void
  readonly setOpen: (open: boolean) => void
}

type SheetAction = "approve" | "send" | "read" | "refresh"

/**
 * The approve → consent → send → outcome sheet for one saved review of an
 * exact Google change, worded for its `noun` ("lodging", "service"): a bottom
 * sheet on a phone with the actions in the footer, the steps under the
 * title, the change as a diff, the exact Google target under "Technical
 * details", and the recorded outcome in the shared outcome words.
 *
 * Approval never sends. Sending needs the approval, a separate consent and
 * a review that has not expired or gone stale; a send in flight is still the
 * review, and a busy sheet with no action of its own is reading a restored
 * outcome.
 */
export function ReviewedChangeSheet({
  workflow,
  noun,
  rows,
  disabled,
  reviewTitle = `Review ${noun} changes`,
  resetKey = "",
}: {
  readonly workflow: ReviewedChangeWorkflow
  /** Lower case, as it reads mid-sentence: "lodging", "service". */
  readonly noun: string
  readonly rows: ChangeRow[]
  readonly disabled: boolean
  readonly reviewTitle?: string
  /** Anything else that should clear the consent and pending action when it changes. */
  readonly resetKey?: string
}) {
  const review = workflow.review
  const expired = useDeadline(review?.expiresAt ?? "1970-01-01T00:00:00Z")
  const token = `${workflow.open}:${review?.id}:${review?.approvedBy}:${workflow.selectionRevision}:${resetKey}`
  const [key, setKey] = useState(token),
    [consent, setConsent] = useState(false),
    [action, setAction] = useState<SheetAction | null>(null)
  if (key !== token) {
    setKey(token)
    setConsent(false)
    setAction(null)
  }
  if (!review) return null
  const blocked =
    disabled ||
    workflow.busy ||
    expired ||
    workflow.stale ||
    workflow.unresolved ||
    !review.targetResourceName
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
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  return (
    <ReviewedWriteSheet
      open={workflow.open}
      onOpenChange={workflow.setOpen}
      title={recorded ? `Saved ${noun} outcome` : reviewTitle}
      description={
        recorded
          ? `Recorded request for the exact ${noun} changes to ${review.locationName}. Nothing is sent again from here.`
          : `Exact ${noun} changes for ${review.locationName}. Approval saves this reviewed request; sending is a separate action.`
      }
      stage={reviewedWriteStage({
        approved: Boolean(review.approvedBy),
        recorded,
      })}
      secondApprover={review.requiresSecondApprover}
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
                Read saved {noun} outcome
              </Button>
              {workflow.outcome ? (
                <Button
                  variant="secondary"
                  disabled={workflow.busy}
                  pending={workflow.busy && action === "refresh"}
                  pendingLabel="Refreshing observation…"
                  onClick={act("refresh", () => workflow.check(true))}
                >
                  Refresh {noun} observation
                </Button>
              ) : null}
            </>
          ) : review.approvedBy ? (
            <Button
              disabled={blocked || !consent}
              pending={sending}
              pendingLabel="Sending…"
              onClick={act("send", workflow.send)}
            >
              Send approved {noun} changes
            </Button>
          ) : (
            <Button
              disabled={blocked || !review.canApprove}
              pending={workflow.busy && action === "approve"}
              onClick={act("approve", workflow.approve)}
            >
              Approve {noun} changes
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <ChangeDiff
          rows={rows}
          caption={`Reviewed ${noun} changes for ${review.locationName}`}
          phase={outcomePhase(
            workflow.outcome,
            workflow.uncertain,
            workflow.stale
          )}
          confirmedAt={workflow.outcome?.observedAt}
        />
        {review.targetResourceName ? (
          <SummaryList
            rows={[
              {
                label: "Exact Google target",
                value: review.targetResourceName,
                technical: true,
              },
            ]}
          />
        ) : (
          <p role="status" className="text-ui text-ink-muted">
            The exact Google target is unavailable. Prepare a fresh review.
          </p>
        )}
        {recorded || sending ? null : (
          <>
            <Expiry
              expiresAt={review.expiresAt}
              approved={Boolean(review.approvedBy)}
              clockExpired={expired}
            />
            {expired || workflow.stale ? (
              <p role="status" className="text-ui text-ink-muted">
                This review needs a fresh preview before sending.
              </p>
            ) : null}
            {review.requiresSecondApprover && !review.approvedBy ? (
              <p className="text-ui text-ink-muted">
                A different current owner or administrator must approve these
                exact changes.
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
          <p role="status" className="text-ui text-ink-muted">
            The send response is unavailable. Read the saved outcome before
            another write.
          </p>
        ) : null}
        {workflow.outcome ? (
          <OutcomeSummary
            aria-label={`${Noun} request outcome`}
            execution={workflow.outcome.executionState}
            confirmation={workflow.outcome.confirmationState}
            observedAt={workflow.outcome.observedAt}
          />
        ) : null}
        {workflow.error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {workflow.error}
          </p>
        ) : null}
        {review.approvedBy && !workflow.outcome && !workflow.uncertain ? (
          <ConsentSlot
            label={`Send these exact approved ${noun} changes to Google.`}
            checked={consent}
            onCheckedChange={setConsent}
            disabled={blocked}
          />
        ) : null}
      </div>
    </ReviewedWriteSheet>
  )
}
