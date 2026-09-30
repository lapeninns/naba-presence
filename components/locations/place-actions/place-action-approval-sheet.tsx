"use client"
import { useState } from "react"
import { ChangeDiff, ReviewTime, outcomePhase } from "@/components/editors/change-diff"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useVerificationExpiry } from "@/components/locations/administration/use-verification-expiry"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import type { usePlaceActionReview } from "./use-place-action-review"

export function PlaceActionApprovalSheet({ workflow, disabled }: { readonly workflow: ReturnType<typeof usePlaceActionReview>; readonly disabled: boolean }) {
  const review = workflow.review, expired = useVerificationExpiry(review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z")
  const token = `${workflow.open}:${review?.changeSet.id}:${review?.changeSet.approvedBy}:${workflow.revision}:${disabled}`
  const [key, setKey] = useState(token), [consent, setConsent] = useState(false)
  if (key !== token) { setKey(token); setConsent(false) }
  if (!review) return null
  const request = review.request, baseline = placeActionBaselineSchema.safeParse(review.changeSet.baseline)
  const before = request.operation === "create" ? null : baseline.success ? baseline.data.links.find((link) => link.name === request.name) : null
  const after = request.operation === "delete" ? null : request.payload
  const rows = [{ field: "Link", before: before?.uri ?? "No link", after: after?.uri ?? "Remove this link" },
    { field: "Action type", before: before ? actionTypeLabel(before.placeActionType) : "No action", after: after ? actionTypeLabel(after.placeActionType) : "Removed" },
    { field: "Preferred", before: before?.isPreferred ? "Yes" : "No", after: after?.isPreferred ? "Yes" : "No" }]
  const blocked = disabled || workflow.busy || expired || workflow.stale || workflow.unresolved || !baseline.success
  return <Sheet open={workflow.open} onOpenChange={workflow.setOpen}><SheetContent side="right" size="wide" className="flex flex-col gap-0">
    <SheetHeader><SheetTitle>Review action link change</SheetTitle><SheetDescription>Exact action link change for {review.changeSet.locationName}. Approval saves the request; sending is a separate action.</SheetDescription></SheetHeader>
    <SheetBody>
      <p className="break-all text-ui text-ink">Exact Google target: {review.target}</p>
      {request.operation !== "create" ? <p className="break-all text-caption text-ink-muted">Action link: {request.name}</p> : null}
      <ChangeDiff rows={rows} caption={`Reviewed action link change for ${review.changeSet.locationName}`} phase={outcomePhase(workflow.outcome, workflow.uncertain)} confirmedAt={workflow.outcome?.observedAt} />
      <p className="text-caption text-ink-muted">{expired ? "Approval expired" : "Approval expires"}: <ReviewTime value={review.changeSet.expiresAt} /></p>
      {expired || workflow.stale ? <p role="status">This review needs a fresh preview before sending.</p> : null}
      {review.changeSet.requiresSecondApprover && !review.changeSet.approvedBy ? <p>A different current owner or administrator must approve this exact change.</p> : null}
      {workflow.uncertain ? <p role="status">The send response is unavailable. Read the saved outcome before another write.</p> : null}
      {workflow.outcome ? <section aria-label="Action link request outcome" className="flex flex-col gap-2">
        <p>{workflow.outcome.executionState === "accepted" ? "Accepted by Google" : workflow.outcome.executionState === "rejected" ? "Rejected by Google" : workflow.outcome.executionState === "pending" ? "Request still in progress" : "Google acknowledgement unknown"}</p>
        <p>{workflow.outcome.confirmationState === "confirmed" ? "Independently confirmed" : workflow.outcome.confirmationState === "unrecorded" ? "No independent confirmation recorded" : workflow.outcome.confirmationState === "pending" ? "Independent observation pending" : "Independent confirmation unresolved"}</p>
        <p className="text-caption text-ink-muted">Observation: {workflow.outcome.observedAt ? <ReviewTime value={workflow.outcome.observedAt} /> : "No dated observation recorded."}</p>
      </section> : null}
      {workflow.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
      {review.changeSet.approvedBy && !workflow.outcome && !workflow.uncertain ? <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} disabled={blocked} label="Send this exact approved action link change to Google." /> : null}
    </SheetBody><SheetFooter className="sm:items-center">
      <Button variant="ghost" className="sm:mr-auto" disabled={workflow.busy} onClick={() => workflow.setOpen(false)}>Keep editing</Button>
      {workflow.outcome || workflow.uncertain ? <><Button variant="secondary" disabled={workflow.busy} onClick={() => workflow.check()}>Read saved action link outcome</Button>{workflow.outcome && workflow.outcome.executionState !== "rejected" && workflow.outcome.confirmationState !== "confirmed" ? <Button variant="secondary" disabled={workflow.busy} onClick={() => workflow.check(true)}>Refresh action link observation</Button> : null}</>
        : review.changeSet.approvedBy ? <Button disabled={blocked || !consent} pending={workflow.busy} onClick={workflow.send}>Send approved action link change</Button>
        : <Button disabled={blocked || !review.changeSet.canApprove} pending={workflow.busy} onClick={workflow.approve}>Approve action link change</Button>}
    </SheetFooter>
  </SheetContent></Sheet>
}
