"use client"

import {
  OutcomeSummary,
  attemptOutcome,
  type SummaryRow,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import type { OperationOutcome } from "@/lib/editors/outcome"
import {
  VerificationMethodCode,
  verificationMethodName,
  verificationRequestDescription,
} from "./verification-method"
import { merchantStandingLabel } from "./verification-observation"

const errors = {
  start_rejected:
    "Google rejected this start request. Check current methods before creating a fresh review.",
  completion_rejected:
    "Google rejected this PIN request. Check current verification state and the PIN before creating a fresh review.",
  verification_failed:
    "Google reports that this exact verification request failed. Follow Google's instructions or check eligible methods for a new review.",
  outcome_unresolved:
    "The exact result could not be established. Refresh this saved outcome; do not send a replacement request to bypass it.",
  refresh_unavailable:
    "The latest refresh was unavailable. Any confirmation shown below is earlier evidence, not a fresh observation.",
} as const

/**
 * Verification-specific headlines over the shared outcome tone. "Live on
 * Google" is the profile-edit wording; a verification request is confirmed,
 * not live, and confirmation never means verification is complete.
 */
const titles: Partial<Record<OperationOutcome, string>> = {
  confirmed_applied: "Confirmed on Google",
  rejected: "Google refused this request",
}
const effects: Partial<Record<OperationOutcome, string>> = {
  confirmed_applied:
    "An independent read of Google matches this exact request. Its phase and your merchant standing are below.",
  awaiting_confirmation:
    "Google took the request. Refresh this saved outcome to check it independently.",
  uncertain:
    "The exact result is not established. Refresh this saved outcome; do not send a replacement request.",
  rejected: "Google refused this exact request.",
}
const phaseLabels = {
  pending: "Pending with Google",
  completed: "Completed with Google",
  failed: "Failed with Google",
  unknown: "Unknown",
} as const

/** A recorded start or PIN attempt in the shared outcome vocabulary. */
export function VerificationAttemptStatus({
  attempt,
  busy,
  onRefresh,
  onState,
}: {
  readonly attempt: VerificationAttempt
  readonly busy: boolean
  readonly onRefresh: () => void
  readonly onState?: () => void
}) {
  const request = attempt.verification
  const merchant = attempt.merchant
  const rows: SummaryRow[] = [
    {
      label: "Verification request phase",
      value: request ? (
        <>
          {`${verificationMethodName(request.method)} · ${phaseLabels[request.phase]}`}
          <VerificationMethodCode method={request.method} />
          <span className="block text-caption text-ink-secondary">
            {verificationRequestDescription(request.method, request.createTime)}
          </span>
        </>
      ) : (
        "Unknown; no exact request was independently observed"
      ),
    },
    {
      label: "Merchant standing",
      value:
        merchantStandingLabel(merchant?.hasVoiceOfMerchant ?? null) ??
        "Unknown",
    },
    ...(request
      ? [{ label: "Google reference", value: request.name, technical: true }]
      : []),
  ]
  const effect = attempt.error ? errors[attempt.error] : undefined
  const note = (
    <p className="text-caption text-ink-muted">
      Request phase and merchant standing are separate. Neither establishes what
      customers currently see on Search or Maps.
    </p>
  )
  const actions = (
    <>
      <Button variant="secondary" disabled={busy} onClick={onRefresh}>
        Refresh saved outcome
      </Button>
      {onState && (
        <Button variant="ghost" disabled={busy} onClick={onState}>
          Check current Google state
        </Button>
      )}
    </>
  )
  // Google observed the request itself failing: whatever the send recorded,
  // this is a failure and must never wear the confirmed (success) tone.
  if (
    request?.phase === "failed" &&
    attemptOutcome(attempt.executionState, attempt.confirmationState) ===
      "confirmed_applied"
  )
    return (
      <OutcomeSummary
        aria-label="Saved verification outcome"
        outcome="failed"
        execution={attempt.executionState}
        confirmation={attempt.confirmationState}
        observedAt={attempt.observedAt}
        titles={{ failed: "Verification request failed" }}
        effect={effect ?? errors.verification_failed}
        rows={rows}
        actions={actions}
      >
        {note}
      </OutcomeSummary>
    )
  const outcome = attemptOutcome(
    attempt.executionState,
    attempt.confirmationState
  )
  return (
    <OutcomeSummary
      aria-label="Saved verification outcome"
      execution={attempt.executionState}
      confirmation={attempt.confirmationState}
      observedAt={attempt.observedAt}
      titles={titles}
      effect={effect ?? effects[outcome]}
      rows={rows}
      actions={actions}
    >
      {note}
    </OutcomeSummary>
  )
}
