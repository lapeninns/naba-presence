"use client"

import { Button } from "@/components/ui/button"
import type { useLifecycle } from "./use-lifecycle"

export function LifecycleOutcome({ workflow }: { readonly workflow: ReturnType<typeof useLifecycle> }) {
  const attempt = workflow.attempt
  if (!attempt) return null
  return <section aria-labelledby="lifecycle-outcome-title" className="flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
    <h2 id="lifecycle-outcome-title" className="text-title font-semibold text-ink">Saved lifecycle outcome</h2>
    <p className="break-all text-ui text-ink-secondary">Exact Google target: {attempt.target} · Source account: {attempt.sourceAccount}</p>
    {attempt.request.operation === "transfer_location" ? <p className="break-all text-ui text-ink-secondary">Reviewed destination: {attempt.request.payload.destinationAccount}</p> : null}
    <p className="text-ui font-semibold text-ink">{attempt.executionState === "accepted" ? "Accepted by Google" : attempt.executionState === "rejected" ? "Rejected by Google" : attempt.executionState === "pending" ? "Request still in progress" : "Google acknowledgement unknown"}</p>
    <p className="text-ui text-ink">{attempt.confirmationState === "confirmed" ? "Independently confirmed" : attempt.confirmationState === "unrecorded" ? "No independent confirmation recorded" : "Independent confirmation unresolved"}</p>
    <p className="text-ui text-ink-secondary">{attempt.postcondition === "location_transferred_between_accounts" ? "The exact location was observed in the destination account and absent from the source account." : attempt.postcondition === "location_absent_from_managed_account" ? "The managed location was absent from the source account, and an independent location read returned not found. Search/Maps removal and customer-review deletion are not confirmed." : "The intended lifecycle outcome has not been independently established. Check the saved outcome before another write."}</p>
    <p className="text-caption text-ink-muted">Observation: {attempt.observedAt ? <time dateTime={attempt.observedAt}>{attempt.observedAt}</time> : "No dated observation recorded"}</p>
    {attempt.request.operation === "transfer_location" ? <p className="text-ui text-ink-secondary">{attempt.localReconciliation === "applied" ? "NabaPresence is linked to the independently confirmed destination account." : attempt.localReconciliation === "conflict" ? "The local account link changed. An operational check is required before reconciling the saved transfer." : attempt.localReconciliation === "not_required" ? "The local account link has not been changed by this request." : "Local account reconciliation is pending. Refresh the independent observation to check the original transfer."}</p> : null}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={workflow.busy} onClick={() => workflow.check()}>Read saved lifecycle outcome</Button><Button variant="secondary" disabled={workflow.busy} onClick={() => workflow.check(true)}>Refresh lifecycle observation</Button><Button variant="ghost" disabled={workflow.busy || workflow.unresolved} onClick={workflow.reset}>Review another lifecycle action</Button></div>
  </section>
}
