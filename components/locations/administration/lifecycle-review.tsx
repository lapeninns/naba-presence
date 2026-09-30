"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useVerificationExpiry } from "./use-verification-expiry"
import type { useLifecycle } from "./use-lifecycle"

export function LifecycleReview({ workflow, locationName, disabled }: {
  readonly workflow: ReturnType<typeof useLifecycle>; readonly locationName: string; readonly disabled: boolean
}) {
  const review = workflow.review
  const expired = useVerificationExpiry(review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z")
  const token = `${review?.changeSet.id}:${review?.changeSet.approvedBy}:${workflow.revision}:${disabled}`
  const [key, setKey] = useState(token), [consent, setConsent] = useState(false), [typedName, setTypedName] = useState("")
  if (key !== token) { setKey(token); setConsent(false); setTypedName("") }
  if (!review) return null
  const transfer = review.request.operation === "transfer_location"
  const blocked = disabled || workflow.busy || workflow.stale || expired || workflow.unresolved
  return <section aria-labelledby="lifecycle-review-title" className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border border-danger-ink bg-surface p-4">
    <h2 id="lifecycle-review-title" className="text-title font-semibold text-ink">Review {transfer ? "account transfer" : "managed-location deletion"}</h2>
    <p className="text-ui text-ink-secondary">Approval records this exact request. Sending is a separate action and can change your management access.</p>
    <dl className="grid min-w-0 gap-2 text-ui">
      <div><dt className="font-semibold">Exact Google location</dt><dd className="break-all">{review.baseline.location.name}</dd></div>
      <div><dt className="font-semibold">Source account</dt><dd className="break-all">{review.baseline.source.account.name} · {review.baseline.source.account.role ?? "Role unknown"}</dd></div>
      {review.request.operation === "transfer_location" ? <div><dt className="font-semibold">Destination account</dt><dd className="break-all">{review.request.payload.destinationAccount} · {review.baseline.destination?.account.role ?? "Role unknown"}</dd></div> : null}
      <div><dt className="font-semibold">Identity observed</dt><dd>{review.baseline.location.placeId ?? "No place ID supplied"} · <time dateTime={review.baseline.observedAt}>{review.baseline.observedAt}</time></dd></div>
      <div><dt className="font-semibold">{review.changeSet.approvedBy ? "Approval" : "Review"} {expired ? "expired at" : "expires"}</dt><dd><time dateTime={review.changeSet.expiresAt}>{review.changeSet.expiresAt}</time></dd></div>
    </dl>
    {!transfer ? <p className="text-ui text-ink-secondary">This requests deletion of the managed Business Profile location. It does not guarantee removal from Search or Maps; customer reviews may remain.</p> : null}
    {expired || workflow.stale ? <p role="status" className="text-ui text-danger-ink">Create a fresh lifecycle review before sending.</p> : null}
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
