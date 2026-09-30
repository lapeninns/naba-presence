"use client"

import { useState } from "react"
import { ApiClientError } from "@/lib/api/client"
import { previewGoogleVerification, approveGoogleVerification, fetchGoogleVerificationReview } from "@/lib/api/google-verification-reviews"
import { executeGoogleVerification, fetchGoogleVerificationAttempt, refreshGoogleVerificationAttempt } from "@/lib/api/google-verification-attempt"
import type { VerificationReview } from "@/lib/contracts/google-verification-review"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { SectionGateNote, useAdministrationSection } from "./context"
import { VerificationStartForm } from "./verification-start-form"
import { VerificationStartReview } from "./verification-start-review"
import { VerificationAttemptStatus } from "./verification-attempt-status"
import { SavedVerificationWorkflows } from "./verification-saved-workflows"
import { useVerificationAction } from "./use-verification-action"

export function ReviewedStartVerification() {
  const { locationId, writeBlocked } = useAdministrationSection()
  const [review, setReview] = useState<VerificationReview | null>(null)
  const [attempt, setAttempt] = useState<VerificationAttempt | null>(null)
  const { busy, active, activate, error, run, invalidate, clearError } = useVerificationAction(locationId, "start")
  const [uncertain, setUncertain] = useState(false)
  const [freshReviewRequired, setFreshReviewRequired] = useState(false)
  // Review ids the server refused as expired; their approval must never read as current.
  const [expiredIds, setExpiredIds] = useState<readonly string[]>([])
  function runReview(action: () => Promise<void>, targetId = review?.changeSet.id) {
    return run(async () => {
      try { await action() }
      catch (error) {
        if (error instanceof ApiClientError && error.code === "approval_expired" && targetId) setExpiredIds((ids) => ids.includes(targetId) ? ids : [...ids, targetId])
        if (error instanceof ApiClientError && error.status === 409 && ["approval_expired", "approval_policy_changed", "approval_stale", "approval_actor_access_changed", "verification_option_changed", "google_target_changed"].includes(error.code)) setFreshReviewRequired(true)
        throw error
      }
    })
  }
  return <div className="flex min-w-0 flex-col gap-4">
    {attempt ? <VerificationAttemptStatus attempt={attempt} busy={busy} onRefresh={() => void run(async () => { setAttempt(await refreshGoogleVerificationAttempt(locationId, attempt.reviewId)); invalidate() })} /> : review ? <VerificationStartReview key={`${review.changeSet.id}:${review.changeSet.approvedBy}:${active}`} review={review} busy={busy} active={active} onActivate={activate} blocked={writeBlocked || freshReviewRequired} uncertain={uncertain} reportedExpired={expiredIds.includes(review.changeSet.id)}
      onApprove={() => void runReview(async () => { setReview(await approveGoogleVerification(locationId, review.changeSet.id, review.changeSet.payloadHash)); activate(); invalidate() })}
      onExecute={() => void runReview(async () => {
        setUncertain(true)
        setAttempt(await executeGoogleVerification(locationId, review.changeSet.id, review.changeSet.payloadHash))
        setUncertain(false); invalidate()
      })}
      onCheck={() => void runReview(async () => {
        try { setAttempt(await fetchGoogleVerificationAttempt(locationId, review.changeSet.id)) }
        catch (error) {
          if (!(error instanceof ApiClientError) || error.status !== 404) throw error
          setUncertain(false)
          setReview(await fetchGoogleVerificationReview(locationId, review.changeSet.id))
        }
        setUncertain(false); invalidate()
      })}
      onBack={() => { setReview(null); setFreshReviewRequired(false); clearError() }}
    /> : <VerificationStartForm locationId={locationId} blocked={writeBlocked} busy={busy} onPreview={(input) => void run(async () => { setReview(await previewGoogleVerification(locationId, input)); activate(); setUncertain(false); setFreshReviewRequired(false); invalidate() })} />}
    {review && !attempt && freshReviewRequired && <p role="status" className="text-ui text-ink-secondary">This request needs a fresh review. Check its saved outcome before replacing an uncertain send; otherwise return to methods.</p>}
    {review && !attempt && !uncertain && <button type="button" className="self-start rounded-(--np-radius-control) px-3 py-2 text-ui underline focus-halo disabled:opacity-50" disabled={busy} onClick={() => void runReview(async () => { setReview(await fetchGoogleVerificationReview(locationId, review.changeSet.id)) })}>Refresh exact review</button>}
    {error && <p role="alert" className="text-ui text-danger-ink">{error}</p>}
    <SectionGateNote />
    <SavedVerificationWorkflows locationId={locationId} busy={busy} expiredReviewIds={expiredIds} onSelect={(item) => void runReview(async () => {
      if (item.attempt) { const saved = await fetchGoogleVerificationAttempt(locationId, item.reviewId); setAttempt(saved); setReview(null); setUncertain(false); setFreshReviewRequired(false) }
      else { const saved = await fetchGoogleVerificationReview(locationId, item.reviewId); setReview(saved); setAttempt(null); setUncertain(false); setFreshReviewRequired(false) }
      activate()
    }, item.reviewId)} />
  </div>
}
