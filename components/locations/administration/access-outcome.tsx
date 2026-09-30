"use client"

import type { ReactNode } from "react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import type { AdministrationAccessAttempt } from "@/lib/contracts/google-administration-attempt"
import type { AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { ACCESS_OPERATION_LABELS } from "./access-review"
import { AccessTarget } from "./access-target"

export function AccessOutcome({ attempt, review, busy, onCheck, onRefresh, onBack }: { attempt: AdministrationAccessAttempt; review?: AdministrationAccessReview | null; busy: boolean; onCheck: () => void; onRefresh: () => void; onBack: () => void }) {
  const execution = { unrecorded: "No acknowledgement recorded", pending: "Awaiting acknowledgement", accepted: "Accepted by Google", rejected: "Rejected by Google", unknown: "Google acknowledgement unknown" }
  const confirmation = { unrecorded: "No independent confirmation", pending: "Independent check pending", confirmed: "Independently confirmed", unresolved: "Outcome unresolved" }
  const effects = { administrator_present: attempt.pendingInvitation ? "Administrator invitation listed; access awaits acceptance" : "Administrator access listed", administrator_role_changed: "Reviewed administrator role listed", administrator_absent: "Reviewed administrator no longer listed", invitation_absent: "Reviewed invitation no longer pending", account_access_present: "Reviewed account and role independently accessible", unknown: "The requested access change is not independently proven" }
  // Describe the target from the reviewed rows when this outcome's review is at
  // hand, otherwise from what Google listed when the outcome was observed.
  const reviewed = review?.changeSet.id === attempt.reviewId ? z.object({ rows: z.array(z.record(z.string(), z.unknown())) }).safeParse(review.changeSet.baseline) : undefined
  const rows = [...(reviewed?.success ? reviewed.data.rows : []), ...(attempt.observation?.baseline.rows ?? [])]
  const details: Array<[string, ReactNode]> = [["Action", ACCESS_OPERATION_LABELS[attempt.request.operation]], ["Google target", <AccessTarget key="target" request={attempt.request} target={attempt.target} rows={rows} />], ["Google acknowledgement", execution[attempt.executionState]], ["Independent outcome", confirmation[attempt.confirmationState]], ["Observed access", effects[attempt.postcondition]], ["Observed at", attempt.observation ? new Date(attempt.observation.observedAt).toLocaleString("en-GB") : "Not available"]]
  return <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
    <dl className="divide-y divide-line rounded-(--np-radius-card) border border-line">
      {details.map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 p-3 sm:grid-cols-2"><dt className="text-caption text-ink-muted">{label}</dt><dd className="text-ui break-words">{value}</dd></div>)}
    </dl>
    {attempt.confirmationState === "unresolved" && <p role="status" className="text-ui text-ink-secondary">Check Google state again. This saved request will not be sent again. Another write to this Google account is blocked until its outcome is resolved.</p>}
    {attempt.error === "refresh_unavailable" && <p role="alert" className="text-ui text-danger-ink">Google could not be read. The previous observation is retained with its original time.</p>}
    {attempt.executionState === "rejected" && <p className="text-ui text-ink-secondary">Google rejected this request. Check current access before reviewing a corrected request.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onCheck}>Read saved access outcome</Button><Button variant="secondary" disabled={busy || attempt.executionState === "rejected"} onClick={onRefresh}>Refresh Google access state</Button><Button variant="ghost" disabled={busy || ["pending", "unresolved"].includes(attempt.confirmationState)} onClick={onBack}>Back to access</Button></div>
  </div>
}
