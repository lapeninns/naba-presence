"use client"

import { useState } from "react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import { ReviewExpiry } from "./review-expiry"
import { useVerificationExpiry } from "./use-verification-expiry"

export const ACCESS_OPERATION_LABELS = { create_admin: "Invite administrator", update_admin: "Change administrator role", delete_admin: "Remove administrator", accept_invitation: "Accept invitation", decline_invitation: "Decline invitation" }
export function AccessReview({ review, busy, blocked, uncertain, stale, onApprove, onExecute, onCheck, onBack }: {
  review: AdministrationAccessReview; busy: boolean; blocked: boolean; uncertain: boolean; stale: boolean
  onApprove: () => void; onExecute: () => void; onCheck: () => void; onBack: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const expired = useVerificationExpiry(review.changeSet.expiresAt)
  const request = review.request, payload = request.payload, change = review.changeSet
  const rows = [["Listing", change.locationName], ["Action", ACCESS_OPERATION_LABELS[request.operation]], ["Google target", review.target]]
  const baseline = z.object({ rows: z.array(z.record(z.string(), z.unknown())) }).safeParse(change.baseline)
  const previous = "name" in payload && baseline.success ? baseline.data.rows.find((row) => row.name === payload.name) : undefined
  if (previous) {
    rows.push(["Current role", typeof previous.role === "string" ? adminRoleLabel(previous.role) : "Not supplied by Google"])
    if (typeof previous.admin === "string") rows.push(["Current administrator", previous.admin])
    if (typeof previous.pendingInvitation === "boolean") rows.push(["Current invitation", previous.pendingInvitation ? "Acceptance pending" : "No pending administrator invitation"])
  }
  if ("scope" in payload) rows.push(["Scope", payload.scope === "account" ? "Whole Google account" : "This Google location"], ["Invitee", payload.admin ?? payload.account ?? "Unknown"])
  if ("role" in payload) rows.push(["Proposed role", adminRoleLabel(payload.role)])
  rows.push(["Observed by Google", new Date(review.observedAt).toLocaleString("en-GB")])
  return <div className="flex min-w-0 flex-col gap-4">
    <p className="text-ui text-ink-secondary">Review this exact target and action. Approval saves permission to send; it does not change access on Google.</p>
    <dl className="divide-y divide-line rounded-(--np-radius-card) border border-line">
      {rows.map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 p-3 sm:grid-cols-2"><dt className="text-caption text-ink-muted">{label}</dt><dd className="text-ui break-words">{value}</dd></div>)}
    </dl>
    <ReviewExpiry className="text-caption text-ink-muted" expiresAt={change.expiresAt} approved={Boolean(change.approvedBy)} clockExpired={expired} />
    {expired || stale ? <p role="alert" className="text-ui text-danger-ink">This review cannot be sent. Check current Google state and create a fresh review.</p> : !change.approvedBy ? <>
      <p className="text-ui text-ink-secondary">{change.requiresSecondApprover ? "A different authorised owner or admin must approve this request. They can open it under Saved access work." : "Approve this exact request before sending it."}</p>
      <Button className="self-start" disabled={busy || blocked || !change.canApprove} onClick={onApprove}>Approve access request</Button>
    </> : <>
      <p role="status" className="text-ui">This exact access request is approved.</p>
      <Checkbox label="Send this exact approved access change to Google." checked={confirmed} onCheckedChange={setConfirmed} disabled={busy || blocked || uncertain} />
      <Button className="self-start" disabled={busy || blocked || uncertain || !confirmed} onClick={onExecute}>Send approved access request</Button>
    </>}
    {uncertain && <p role="status" className="text-ui text-ink-secondary">The send response was unavailable. Check the saved outcome before taking another action.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onCheck}>Check saved access outcome</Button><Button variant="ghost" disabled={busy || uncertain} onClick={onBack}>Back to access</Button></div>
  </div>
}
