"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { VerificationCompletionReview as CompletionReview } from "@/lib/contracts/google-verification-completion-review"
import { VerificationRequestReference, verificationMethodName, verificationRequestDescription } from "./verification-method"
import { ReviewExpiry } from "./review-expiry"
import { useVerificationExpiry } from "./use-verification-expiry"
import { VerificationPinField } from "./verification-pin-field"

export function VerificationCompletionReview({ review, busy, active, blocked, uncertain, freshReviewRequired, reportedExpired = false, onActivate, onApprove, onExecute, onCheck, onRefresh, onReset }: {
  readonly review: CompletionReview; readonly busy: boolean; readonly blocked: boolean; readonly uncertain: boolean; readonly freshReviewRequired: boolean
  readonly onApprove: () => void; readonly onExecute: (pin: string) => void; readonly onCheck: () => void; readonly onRefresh: () => void; readonly onReset: () => void
  readonly active: boolean; readonly onActivate: () => void
  /** The server refused this review as expired, even if its recorded deadline has not passed here. */
  readonly reportedExpired?: boolean
}) {
  const [confirmed, setConfirmed] = useState(false)
  const change = review.changeSet, clockExpired = useVerificationExpiry(change.expiresAt), expired = clockExpired || reportedExpired
  return <div className="flex min-w-0 flex-col gap-4">
    <h3 className="text-title font-semibold">Review PIN completion</h3>
    <p className="text-ui text-ink-secondary">Approval binds the PIN entered during preview to this exact pending request. The PIN is not displayed or restored. Nothing is sent to Google until the approved PIN is re-entered and submitted.</p>
    <dl className="divide-y divide-line rounded-(--np-radius-card) border border-line">
      {([["Listing", change.locationName], ["Method", verificationMethodName(review.payload.method)], ["Verification request", <>{verificationRequestDescription(review.payload.method, review.verification.createTime)}<VerificationRequestReference name={review.payload.name} /></>], ["Reviewed request phase", "Pending with Google"]] satisfies readonly (readonly [string, ReactNode])[]).map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 p-3 sm:grid-cols-2"><dt className="text-caption text-ink-muted">{label}</dt><dd className="min-w-0 text-ui break-words">{value}</dd></div>)}
    </dl>
    <ReviewExpiry expiresAt={change.expiresAt} approved={Boolean(change.approvedBy)} clockExpired={clockExpired} reportedExpired={reportedExpired} />
    {expired ? <p role="status" className="text-ui text-danger-ink">{change.approvedBy ? "This PIN approval has expired and the PIN can no longer be submitted." : "This PIN review has expired."} Check current Google state before a fresh preview.</p> : freshReviewRequired ? <p role="alert" className="text-ui text-danger-ink">The PIN or Google state no longer matches this review. Create a fresh PIN review and approval.</p> : !change.approvedBy ? <>
      <p className="text-ui text-ink-secondary">{change.requiresSecondApprover ? "A different authorised owner or admin must approve this exact request. They can find it under Saved PIN completions." : "Approve this exact PIN completion before submitting to Google."}</p>
      <Button className="self-start" disabled={busy || blocked || !change.canApprove} onClick={onApprove}>Approve PIN completion</Button>
    </> : !active ? <Button variant="secondary" className="self-start" disabled={busy} onClick={onActivate}>Continue approved PIN completion</Button> : <>
      <p role="status" className="text-ui">{uncertain && !busy ? "The result of sending this approved PIN is unknown. Check the saved PIN outcome before any other action." : "This PIN completion is approved."}</p>
      <Checkbox label="Submit the reviewed PIN to this exact Google verification request." checked={confirmed} disabled={busy || blocked || uncertain} onCheckedChange={setConfirmed} />
      <VerificationPinField name={review.payload.name} blocked={blocked || uncertain} busy={busy} reentry confirmed={confirmed} onSubmit={onExecute} />
    </>}
    {uncertain && !busy && <p role="status" className="text-ui text-ink-secondary">The send response was unavailable. Check the saved outcome before another action. Do not submit another PIN request to bypass it.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={onCheck}>Check saved PIN outcome</Button>
      <Button variant="ghost" disabled={busy || uncertain} onClick={onRefresh}>Refresh exact PIN review</Button>
      <Button variant="ghost" disabled={busy || uncertain} onClick={onReset}>Create a fresh PIN review</Button>
    </div>
  </div>
}
