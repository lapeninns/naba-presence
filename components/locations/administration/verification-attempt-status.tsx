"use client"

import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { VerificationMethodCode, VerificationRequestReference, verificationMethodName, verificationRequestDescription } from "./verification-method"
import { merchantStandingLabel } from "./verification-observation"

const executionLabels = { unrecorded: "No execution evidence", pending: "Request in progress", accepted: "Google accepted the request", rejected: "Google rejected the request", unknown: "Request outcome unknown" } as const
const confirmationLabels = { unrecorded: "No independent confirmation", pending: "Confirmation pending", confirmed: "Independently confirmed", unresolved: "Confirmation unresolved" } as const
const errors = {
  start_rejected: "Google rejected this start request. Check current methods before creating a fresh review.",
  completion_rejected: "Google rejected this PIN request. Check current verification state and the PIN before creating a fresh review.",
  verification_failed: "Google reports that this exact verification request failed. Follow Google's instructions or check eligible methods for a new review.",
  outcome_unresolved: "The exact result could not be established. Refresh this saved outcome; do not send a replacement request to bypass it.",
  refresh_unavailable: "The latest refresh was unavailable. Any confirmation shown below is earlier evidence, not a fresh observation.",
} as const

export function VerificationAttemptStatus({ attempt, busy, onRefresh, onState }: {
  readonly attempt: VerificationAttempt; readonly busy: boolean; readonly onRefresh: () => void; readonly onState?: () => void
}) {
  const request = attempt.verification
  const merchant = attempt.merchant
  return <div className="flex min-w-0 flex-col gap-3" aria-label="Saved verification outcome">
    <div className="flex flex-wrap gap-2">
      <StatusPill tone={attempt.executionState === "rejected" ? "at-risk" : "neutral"}>{executionLabels[attempt.executionState]}</StatusPill>
      <StatusPill tone={attempt.confirmationState === "confirmed" && request?.phase !== "failed" ? "healthy" : "pending"}>{confirmationLabels[attempt.confirmationState]}</StatusPill>
    </div>
    {attempt.error && <p role="status" className="text-ui text-ink-secondary">{errors[attempt.error]}</p>}
    <dl className="grid min-w-0 gap-2 text-ui">
      <div><dt className="text-caption text-ink-muted">Verification request phase</dt><dd>{request ? <>{`${verificationMethodName(request.method)} · ${request.phase === "pending" ? "Pending with Google" : request.phase === "completed" ? "Completed with Google" : request.phase === "failed" ? "Failed with Google" : "Unknown"}`}<VerificationMethodCode method={request.method} /><span className="block text-caption text-ink-secondary">{verificationRequestDescription(request.method, request.createTime)}</span><VerificationRequestReference name={request.name} /></> : "Unknown; no exact request was independently observed"}</dd></div>
      <div><dt className="text-caption text-ink-muted">Merchant standing</dt><dd>{merchantStandingLabel(merchant?.hasVoiceOfMerchant ?? null) ?? "Unknown"}</dd></div>
      <div><dt className="text-caption text-ink-muted">Independent observation</dt><dd className="font-mono text-caption">{attempt.observedAt ? new Date(attempt.observedAt).toLocaleString("en-GB") : "Not recorded"}</dd></div>
    </dl>
    <p className="text-caption text-ink-muted">Request phase and merchant standing are separate. Neither establishes what customers currently see on Search or Maps.</p>
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onRefresh}>Refresh saved outcome</Button>{onState && <Button variant="ghost" disabled={busy} onClick={onState}>Check current Google state</Button>}</div>
  </div>
}
