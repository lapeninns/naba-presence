"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ReviewTime } from "@/components/editors/change-diff"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import { ReviewExpiry } from "./review-expiry"
import { useVerificationExpiry } from "./use-verification-expiry"
import type { LifecycleBlock, useLifecycle } from "./use-lifecycle"

function roleText(role: string | null | undefined) {
  return role ? adminRoleLabel(role) : "Role unknown"
}

function blockMessage(block: LifecycleBlock | null, expired: boolean, transfer: boolean, approved: boolean): string {
  if (expired || block === "expired") return `This ${approved ? "approval" : "review"} has expired, so the request can no longer be ${approved ? "sent" : "approved"}. Start a fresh review to check Google again.`
  if (block === "destination_changed") return "The destination account's access on Google changed since this review, so the reviewed destination role is no longer current. Start a fresh review to check it again."
  if (block === "access_changed") return transfer
    ? "The destination or source account's access on Google changed since this review, so the reviewed roles are no longer current. Start a fresh review to check them again."
    : "Google account access or location membership changed since this review. Start a fresh review to check it again."
  return "This review no longer matches Google. Start a fresh review before sending."
}

export function LifecycleReview({ workflow, locationName, disabled }: {
  readonly workflow: ReturnType<typeof useLifecycle>; readonly locationName: string; readonly disabled: boolean
}) {
  const review = workflow.review
  const clockExpired = useVerificationExpiry(review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z")
  const token = `${review?.changeSet.id}:${review?.changeSet.approvedBy}:${workflow.revision}:${disabled}`
  const [key, setKey] = useState(token), [consent, setConsent] = useState(false), [typedName, setTypedName] = useState("")
  if (key !== token) { setKey(token); setConsent(false); setTypedName("") }
  if (!review) return null
  const transfer = review.request.operation === "transfer_location"
  const reportedExpired = workflow.block === "expired"
  const expired = clockExpired || reportedExpired
  // Once access drift is reported, the reviewed roles are a record of the
  // review, not Google's current state.
  const drifted = workflow.block === "destination_changed" || workflow.block === "access_changed"
  const reviewedRole = (role: string | null | undefined) => drifted ? `${roleText(role)} at review, no longer current` : roleText(role)
  const blocked = disabled || workflow.busy || workflow.stale || expired || workflow.unresolved
  const listingName = review.changeSet.locationName || locationName
  return <section aria-labelledby="lifecycle-review-title" className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border border-danger-ink bg-surface p-4">
    <h2 id="lifecycle-review-title" className="text-title font-semibold text-ink">Review {transfer ? "account transfer" : "managed-location deletion"}</h2>
    <p className="text-ui text-ink-secondary">Approval records this exact request. Sending is a separate action and can change your management access.</p>
    <dl className="grid min-w-0 gap-2 text-ui">
      <div><dt className="font-semibold">Exact Google location</dt><dd className="flex min-w-0 flex-col"><span>{listingName || "Name unavailable"}</span><span className="break-all text-caption text-ink-muted">Google location: {review.baseline.location.name}</span></dd></div>
      <div><dt className="font-semibold">Source account</dt><dd className="break-all">{review.baseline.source.account.name} · {transfer ? reviewedRole(review.baseline.source.account.role) : roleText(review.baseline.source.account.role)}</dd></div>
      {review.request.operation === "transfer_location" ? <div><dt className="font-semibold">Destination account</dt><dd className="break-all">{review.request.payload.destinationAccount} · {reviewedRole(review.baseline.destination?.account.role)}</dd></div> : null}
      <div><dt className="font-semibold">Identity checked</dt><dd className="flex min-w-0 flex-col"><span>Checked on Google <ReviewTime value={review.baseline.observedAt} /></span><span className="break-all text-caption text-ink-muted">Google place ID: {review.baseline.location.placeId ?? "not supplied"}</span></dd></div>
    </dl>
    {reportedExpired && !clockExpired && workflow.blockedAt
      // The server refused an expiry the local clock had not reached; state
      // when that was reported rather than the earlier, future-looking deadline.
      ? <p className="text-ui font-semibold text-danger-ink">{review.changeSet.approvedBy ? "Approval" : "Review"} expired · checked <ReviewTime value={workflow.blockedAt} /></p>
      : <ReviewExpiry format="instant" className={expired ? "text-ui font-semibold text-danger-ink" : "text-caption text-ink-muted"} expiresAt={review.changeSet.expiresAt} approved={Boolean(review.changeSet.approvedBy)} clockExpired={clockExpired} reportedExpired={reportedExpired} />}
    {!transfer ? <p className="text-ui text-ink-secondary">This requests deletion of the managed Business Profile location. It does not guarantee removal from Search or Maps; customer reviews may remain.</p> : null}
    {expired || workflow.stale ? <div className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-card) border border-line p-3">
      <p role="status" className="text-ui text-danger-ink">{blockMessage(workflow.block, expired, transfer, Boolean(review.changeSet.approvedBy))}</p>
      <Button variant="secondary" size="sm" disabled={disabled || workflow.busy || workflow.unresolved} pending={workflow.busy} onClick={workflow.refreshReview}>Start a fresh review</Button>
    </div> : null}
    {review.changeSet.requiresSecondApprover && !review.changeSet.approvedBy ? <p className="text-ui text-ink-secondary">A different current owner or administrator must approve this exact request.</p> : null}
    {workflow.uncertain ? <p role="status" className="text-ui text-ink-secondary">The send response is unavailable. Read the saved outcome before another lifecycle write.</p> : null}
    {review.changeSet.approvedBy && !workflow.uncertain ? <>
      <Field><FieldLabel htmlFor="lifecycle-typed-name">Type the listing name: {locationName || "Name unavailable"}</FieldLabel><Input id="lifecycle-typed-name" value={typedName} onChange={(event) => setTypedName(event.target.value)} disabled={blocked} autoComplete="off" /></Field>
      <Checkbox checked={consent} onCheckedChange={(value) => setConsent(value === true)} disabled={blocked} label="Send this exact approved lifecycle request to Google." />
    </> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" disabled={workflow.busy || workflow.unresolved} onClick={workflow.reset}>Keep this location unchanged</Button>
      {workflow.uncertain ? <Button variant="secondary" disabled={workflow.busy} onClick={() => workflow.check()}>Read saved lifecycle outcome</Button> : review.changeSet.approvedBy ? <Button variant="danger" disabled={blocked || !consent || !locationName || typedName !== locationName} pending={workflow.busy} onClick={workflow.execute}>Send approved {transfer ? "transfer" : "deletion"}</Button> : <Button disabled={blocked || !review.changeSet.canApprove} pending={workflow.busy} onClick={workflow.approve}>Approve lifecycle request</Button>}
    </div>
  </section>
}
