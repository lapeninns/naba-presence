"use client"

import { useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import { previewGoogleVerificationCompletion, fetchGoogleVerificationCompletionReview, approveGoogleVerificationCompletion } from "@/lib/api/google-verification-completion-reviews"
import { executeGoogleVerificationCompletion, fetchGoogleVerificationCompletionAttempt, refreshGoogleVerificationCompletionAttempt } from "@/lib/api/google-verification-completion-attempt"
import { verificationCompletionInputSchema, verificationCompletionPayloadSchema, type VerificationCompletionReview as CompletionReview } from "@/lib/contracts/google-verification-completion-review"
import type { ObservedVerification } from "@/lib/contracts/google-verification-state"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { cn } from "@/lib/utils"
import { useGoogleVerificationState } from "@/lib/queries/use-google-verification-state"
import { SectionGateNote, useAdministrationSection } from "./context"
import { VerificationPinField } from "./verification-pin-field"
import { VerificationCompletionReview } from "./verification-completion-review"
import { VerificationAttemptStatus } from "./verification-attempt-status"
import { SavedVerificationWorkflows } from "./verification-saved-workflows"
import { VerificationMethodCode, verificationMethodName } from "./verification-method"
import { useVerificationAction } from "./use-verification-action"

export function ReviewedCompletionVerification({ verifications }: { readonly verifications: readonly ObservedVerification[] }) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const [review, setReview] = useState<CompletionReview | null>(null), [attempt, setAttempt] = useState<VerificationAttempt | null>(null)
  const [uncertain, setUncertain] = useState(false), [freshReviewRequired, setFreshReviewRequired] = useState(false)
  const [reviewVersion, setReviewVersion] = useState(0)
  // Review ids the server refused as expired; their approval must never read as current.
  const [expiredIds, setExpiredIds] = useState<readonly string[]>([])
  const { busy, active, activate, error, run, invalidate, clearError } = useVerificationAction(locationId, "complete")
  const current = useGoogleVerificationState(locationId, false)
  function runReview(action: () => Promise<void>, targetId = review?.changeSet.id) {
    return run(async () => {
      try { await action() }
      catch (error) {
        if (error instanceof ApiClientError && error.code === "approval_expired" && targetId) setExpiredIds((ids) => ids.includes(targetId) ? ids : [...ids, targetId])
        if (error instanceof ApiClientError && error.status === 409 && ["approval_expired", "approval_policy_changed", "approval_stale", "approval_actor_access_changed", "verification_pin_changed", "verification_state_changed", "google_target_changed", "verification_not_pending"].includes(error.code)) setFreshReviewRequired(true)
        throw error
      }
    })
  }
  function reset() { setReview(null); setAttempt(null); setFreshReviewRequired(false); setUncertain(false); clearError() }
  const pending = (current.data?.verifications ?? verifications).filter((item) => item.phase === "pending")
  function checkState() { void run(async () => { const result = await current.refetch(); if (result.error) throw result.error }) }
  return <div className="flex min-w-0 flex-col gap-4">
    <Button variant="secondary" className="self-start" disabled={busy} onClick={checkState}>Check current Google verification state</Button>
    {current.data && <p className="font-mono text-caption text-ink-muted">Current requests last checked {new Date(current.data.checkedAt).toLocaleString("en-GB")}.</p>}
    {current.isError && <p role="status" className="text-ui text-ink-secondary">Current Google state could not be refreshed. Any request details still shown are earlier observations.</p>}
    {attempt ? <>
      <VerificationAttemptStatus attempt={attempt} busy={busy} onRefresh={() => void run(async () => { setAttempt(await refreshGoogleVerificationCompletionAttempt(locationId, attempt.reviewId)); invalidate() })} onState={checkState} />
      {(attempt.error === "completion_rejected" || attempt.verification?.phase === "failed") && <Button variant="ghost" className="self-start" disabled={busy} onClick={reset}>Review a corrected PIN after checking Google state</Button>}
    </> : review ? <VerificationCompletionReview key={`${review.changeSet.id}:${review.changeSet.approvedBy}:${reviewVersion}:${active}`} review={review} busy={busy} active={active} onActivate={activate} blocked={writeBlocked} uncertain={uncertain} freshReviewRequired={freshReviewRequired} reportedExpired={expiredIds.includes(review.changeSet.id)}
      onApprove={() => void runReview(async () => { setReview(await approveGoogleVerificationCompletion(locationId, review.changeSet.id, review.changeSet.payloadHash)); activate(); invalidate() })}
      onExecute={(pin) => void runReview(async () => {
        setUncertain(true)
        try { setAttempt(await executeGoogleVerificationCompletion(locationId, review.changeSet.id, review.changeSet.payloadHash, pin)); setUncertain(false); invalidate() }
        catch (error) {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
            setUncertain(false)
            if (["verification_pin_changed", "approval_stale", "verification_state_changed", "google_target_changed", "verification_not_pending"].includes(error.code)) setFreshReviewRequired(true)
          }
          throw error
        }
      })}
      onCheck={() => void runReview(async () => {
        try { setAttempt(await fetchGoogleVerificationCompletionAttempt(locationId, review.changeSet.id)) }
        catch (error) {
          if (!(error instanceof ApiClientError) || error.status !== 404) throw error
          setUncertain(false)
          setReview(await fetchGoogleVerificationCompletionReview(locationId, review.changeSet.id))
          setReviewVersion((version) => version + 1)
        }
        setUncertain(false); invalidate()
      })}
      onRefresh={() => void runReview(async () => { setReview(await fetchGoogleVerificationCompletionReview(locationId, review.changeSet.id)); setReviewVersion((version) => version + 1) })}
      onReset={reset}
    /> : <>
      {!pending.length && <p className="text-ui text-ink-muted">No independently known pending request is available for PIN entry. Check current Google state or inspect saved completions below.</p>}
      <ul aria-label="Pending verification requests" className="flex list-none flex-col gap-3">
        {pending.map((item) => {
          const supported = verificationCompletionPayloadSchema.shape.method.safeParse(item.method).success && verificationCompletionInputSchema.shape.name.safeParse(item.name).success
          return <li key={item.name} className="flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="text-body font-semibold">{verificationMethodName(item.method)}</span><StatusPill tone="pending">Pending with Google</StatusPill></div>
            <VerificationMethodCode method={item.method} />
            <p className="font-mono text-caption break-all text-ink-muted">{item.name}</p>
            {supported ? <VerificationPinField name={item.name} blocked={writeBlocked} busy={busy} onSubmit={(pin) => void run(async () => {
              setReview(await previewGoogleVerificationCompletion(locationId, { name: item.name, pin })); activate(); setFreshReviewRequired(false); setUncertain(false); invalidate()
            })} /> : <p className="text-ui text-ink-secondary">This pending method cannot accept a PIN here. Follow the instructions in Google, then refresh its state.</p>}
          </li>
        })}
      </ul>
      <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "self-start")}>Continue verification in Google</a>
    </>}
    {error && <p role="alert" className="text-ui text-danger-ink">{error}</p>}
    <SectionGateNote />
    <SavedVerificationWorkflows locationId={locationId} operation="complete" busy={busy} expiredReviewIds={expiredIds} onSelect={(item) => void runReview(async () => {
      if (item.attempt) { const saved = await fetchGoogleVerificationCompletionAttempt(locationId, item.reviewId); setAttempt(saved); setReview(null) }
      else { const saved = await fetchGoogleVerificationCompletionReview(locationId, item.reviewId); setReview(saved); setAttempt(null); setReviewVersion((version) => version + 1) }
      activate(); setUncertain(false); setFreshReviewRequired(false)
    }, item.reviewId)} />
  </div>
}
