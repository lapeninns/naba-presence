"use client"

import { useState } from "react"
import { ChangeDiff, ReviewTime, instantCell, outcomePhase } from "@/components/editors/change-diff"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { lodgingReviewRows } from "@/lib/locations/forms/lodging-review"
import type { useLodgingReview } from "./use-lodging-review"
import { useVerificationExpiry } from "@/components/locations/administration/use-verification-expiry"

type SheetAction = "approve" | "send" | "read" | "refresh"

export function LodgingApprovalSheet({ workflow, disabled }: {
  readonly workflow: ReturnType<typeof useLodgingReview>; readonly disabled: boolean
}) {
  const review = workflow.review
  const expired = useVerificationExpiry(review?.expiresAt ?? "1970-01-01T00:00:00Z")
  const token = `${workflow.open}:${review?.id}:${review?.approvedBy}:${workflow.selectionRevision}`
  const [key, setKey] = useState(token), [consent, setConsent] = useState(false), [action, setAction] = useState<SheetAction | null>(null)
  if (key !== token) { setKey(token); setConsent(false); setAction(null) }
  if (!review) return null
  const blocked = disabled || workflow.busy || expired || workflow.stale || workflow.unresolved || !review.targetResourceName
  // A send marks the review uncertain before the response arrives; until it
  // settles this is still the review, not a lost response.
  const sending = workflow.busy && action === "send"
  // A busy sheet with no action of its own is reading a restored outcome.
  const reading = workflow.busy && (action === "read" || action === null)
  const recorded = Boolean(workflow.outcome || workflow.uncertain) && !sending
  const act = (next: SheetAction, work: () => void) => () => { setAction(next); work() }
  return <Sheet open={workflow.open} onOpenChange={workflow.setOpen}>
    <SheetContent side="right" size="wide" className="flex flex-col gap-0">
      <SheetHeader>
        <SheetTitle>{recorded ? "Saved lodging outcome" : "Review changes"}</SheetTitle>
        <SheetDescription>{recorded ? `Recorded request for the exact lodging changes to ${review.locationName}. Nothing is sent again from here.` : `Exact lodging changes for ${review.locationName}. Approval saves the reviewed request; sending is a separate action.`}</SheetDescription>
      </SheetHeader>
      <SheetBody>
        <p className="break-all text-ui text-ink">Exact Google target: {review.targetResourceName ?? "Unavailable. Prepare a fresh review."}</p>
        <ChangeDiff rows={lodgingReviewRows(review).map((row) => ({ ...row, before: instantCell(row.before), after: instantCell(row.after) }))} caption={`Reviewed lodging changes for ${review.locationName}`} phase={outcomePhase(workflow.outcome, workflow.uncertain, workflow.stale)} confirmedAt={workflow.outcome?.observedAt} />
        {recorded || sending ? null : <>
          <p className="text-caption text-ink-muted">{expired ? "Approval expired" : "Approval expires"}: <ReviewTime value={review.expiresAt} /></p>
          {expired || workflow.stale ? <p role="status" className="text-ui text-ink-muted">This review needs a fresh preview before sending.</p> : null}
          {review.requiresSecondApprover && !review.approvedBy ? <p className="text-ui text-ink-muted">A different current owner or administrator must approve these exact changes.</p> : null}
        </>}
        {reading && !recorded ? <p role="status" className="text-ui text-ink-muted">Checking for a saved outcome…</p> : null}
        {sending ? <p role="status" className="text-ui text-ink-muted">Sending to Google. The outcome appears here when the response arrives.</p> : null}
        {workflow.uncertain && !workflow.busy ? <p role="status" className="text-ui text-ink-muted">The send response is unavailable. Read the saved outcome before another write.</p> : null}
        {workflow.outcome ? <section aria-label="Lodging request outcome" className="flex flex-col gap-2">
          <p className="text-ui font-semibold text-ink">{workflow.outcome.executionState === "accepted" ? "Accepted by Google" : workflow.outcome.executionState === "rejected" ? "Rejected by Google" : workflow.outcome.executionState === "pending" ? "Request still in progress" : "Google acknowledgement unknown"}</p>
          <p className="text-ui text-ink">{workflow.outcome.confirmationState === "confirmed" ? "Independently confirmed" : workflow.outcome.confirmationState === "unrecorded" ? "No independent confirmation recorded" : workflow.outcome.confirmationState === "pending" ? "Independent observation pending" : "Independent confirmation unresolved"}</p>
          <p className="text-caption text-ink-muted">Observation: {workflow.outcome.observedAt ? <ReviewTime value={workflow.outcome.observedAt} /> : "No dated observation loaded. Read the saved outcome."}</p>
        </section> : null}
        {workflow.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
        {review.approvedBy && !workflow.outcome && !workflow.uncertain ? <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} disabled={blocked} label="Send these exact approved lodging changes to Google." /> : null}
      </SheetBody>
      <SheetFooter className="sm:items-center">
        <Button variant="ghost" className="sm:mr-auto" disabled={workflow.busy} onClick={() => workflow.setOpen(false)}>Keep editing</Button>
        {recorded ? <>
          <Button variant="secondary" disabled={workflow.busy} pending={reading} pendingLabel="Reading saved outcome…" onClick={act("read", () => workflow.check())}>Read saved lodging outcome</Button>
          {workflow.outcome ? <Button variant="secondary" disabled={workflow.busy} pending={workflow.busy && action === "refresh"} pendingLabel="Refreshing observation…" onClick={act("refresh", () => workflow.check(true))}>Refresh lodging observation</Button> : null}
        </> : review.approvedBy ? <Button disabled={blocked || !consent} pending={sending} pendingLabel="Sending…" onClick={act("send", workflow.send)}>Send approved lodging changes</Button>
          : <Button disabled={blocked || !review.canApprove} pending={workflow.busy && action === "approve"} onClick={act("approve", workflow.approve)}>Approve lodging changes</Button>}
      </SheetFooter>
    </SheetContent>
  </Sheet>
}
