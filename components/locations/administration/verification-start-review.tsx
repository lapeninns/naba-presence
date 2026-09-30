"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ActionBar } from "@/components/ui/action-bar"
import type { VerificationReview } from "@/lib/contracts/google-verification-review"
import { verificationChoiceDestination } from "@/lib/locations/forms/verification"
import { verificationMethodName } from "./verification-method"
import { ReviewExpiry } from "./review-expiry"
import { useVerificationExpiry } from "./use-verification-expiry"

export function VerificationStartReview({ review, busy, active, blocked, uncertain, reportedExpired = false, onActivate, onApprove, onExecute, onCheck, onBack }: {
  readonly review: VerificationReview; readonly busy: boolean; readonly blocked: boolean; readonly uncertain: boolean
  readonly onApprove: () => void; readonly onExecute: () => void; readonly onCheck: () => void; readonly onBack: () => void
  readonly active: boolean; readonly onActivate: () => void
  /** The server refused this review as expired, even if its recorded deadline has not passed here. */
  readonly reportedExpired?: boolean
}) {
  const [confirmed, setConfirmed] = useState(false)
  const change = review.changeSet, payload = review.payload
  const clockExpired = useVerificationExpiry(change.expiresAt), expired = clockExpired || reportedExpired
  const destination = payload.method === "EMAIL" ? payload.emailAddress : verificationChoiceDestination(review.choice)
  const addressLabels: Readonly<Record<string, string>> = { regionCode: "Country", languageCode: "Address language", addressLines: "Street address", locality: "Town or city", administrativeArea: "County or region", postalCode: "Postcode", sublocality: "Neighbourhood", sortingCode: "Sorting code", organization: "Organisation", recipients: "Recipients", revision: "Address revision" }
  const rows = [
    ["Listing", change.locationName], ["Method", verificationMethodName(payload.method)],
    ["Destination", destination], ["Message language", payload.languageCode],
    ...(payload.method === "ADDRESS" ? [["Postcard contact", payload.mailerContact]] : []),
    ...(payload.context ? [["Private service-business address", Object.entries(payload.context.address).map(([key, value]) => `${addressLabels[key] ?? key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n")]] : []),
  ]
  return <div className="flex min-w-0 flex-col gap-4">
    <p className="text-ui text-ink-secondary">Review this exact request. Approval does not send it to Google. A successful start request does not mean verification is complete.</p>
    <dl className="divide-y divide-line rounded-(--np-radius-card) border border-line">
      {rows.map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 p-3 sm:grid-cols-2"><dt className="text-caption text-ink-muted">{label}</dt><dd className="text-ui break-words whitespace-pre-wrap">{value}</dd></div>)}
    </dl>
    <ReviewExpiry expiresAt={change.expiresAt} approved={Boolean(change.approvedBy)} clockExpired={clockExpired} reportedExpired={reportedExpired} />
    {expired ? <p role="status" className="text-ui text-danger-ink">{change.approvedBy ? "This approval has expired and the request can no longer be sent." : "This review has expired."} Check available methods and create a fresh review.</p> : !change.approvedBy ? <>
      <p className="text-ui text-ink-secondary">{change.requiresSecondApprover ? "A different authorised owner or admin must approve this exact request. They can find it under Saved verification requests." : "Approve the exact destination and context before sending."}</p>
      <Button className="self-start" disabled={busy || blocked || !change.canApprove} onClick={onApprove}>Approve verification request</Button>
    </> : !active ? <Button variant="secondary" className="self-start" disabled={busy} onClick={onActivate}>Continue approved verification start</Button> : <>
      <p role="status" className="text-ui">This request is approved.</p>
      <Checkbox label="Send this exact approved verification request to Google." checked={confirmed} disabled={busy || blocked || uncertain} onCheckedChange={setConfirmed} />
      <ActionBar sticky={false} safeArea={false} label="Approved verification request actions"
        status={busy ? "Request action in progress. Wait for a response." : blocked ? "Sending is unavailable. Resolve the review or access issue before continuing." : uncertain ? "Check the saved outcome before sending again." : !confirmed ? "Confirm the exact approved request before sending." : "Send only this exact approved request to Google."}
        actions={<Button disabled={busy || blocked || !confirmed || uncertain} onClick={onExecute}>Send approved verification request</Button>} />
    </>}
    {uncertain && !busy && <p role="status" className="text-ui text-ink-secondary">The response was unavailable. Check the saved outcome before taking another action; do not start a replacement request.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={onCheck}>Check saved request outcome</Button>
      <Button variant="ghost" disabled={busy || uncertain} onClick={onBack}>Back to methods</Button>
    </div>
  </div>
}
