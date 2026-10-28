"use client"

import { useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Instant,
  ReviewedWritePanel,
  reviewedWriteStage,
} from "@/components/reviewed-write"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { StatusPill } from "@/components/ui/status-pill"
import { ApiClientError } from "@/lib/api/client"
import {
  previewGoogleVerificationCompletion,
  fetchGoogleVerificationCompletionReview,
  approveGoogleVerificationCompletion,
} from "@/lib/api/google-verification-completion-reviews"
import {
  executeGoogleVerificationCompletion,
  fetchGoogleVerificationCompletionAttempt,
  refreshGoogleVerificationCompletionAttempt,
} from "@/lib/api/google-verification-completion-attempt"
import {
  verificationCompletionInputSchema,
  verificationCompletionPayloadSchema,
  type VerificationCompletionReview as CompletionReview,
} from "@/lib/contracts/google-verification-completion-review"
import type { ObservedVerification } from "@/lib/contracts/google-verification-state"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { cn } from "@/lib/utils"
import { useGoogleVerificationState } from "@/lib/queries/use-google-verification-state"
import { SectionGateNote, useAdministrationSection } from "./context"
import { VerificationPinField } from "./verification-pin-field"
import { VerificationCompletionReview } from "./verification-completion-review"
import { VerificationAttemptStatus } from "./verification-attempt-status"
import { SavedVerificationWorkflows } from "./verification-saved-workflows"
import {
  VerificationMethodCode,
  VerificationRequestReference,
  verificationMethodName,
  verificationRequestDescription,
} from "./verification-method"
import { useVerificationAction } from "./use-verification-action"

export function ReviewedCompletionVerification({
  verifications,
}: {
  readonly verifications: readonly ObservedVerification[]
}) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const [review, setReview] = useState<CompletionReview | null>(null),
    [attempt, setAttempt] = useState<VerificationAttempt | null>(null)
  const [uncertain, setUncertain] = useState(false),
    [freshReviewRequired, setFreshReviewRequired] = useState(false)
  const [reviewVersion, setReviewVersion] = useState(0)
  // Review ids the server refused as expired; their approval must never read as current.
  const [expiredIds, setExpiredIds] = useState<readonly string[]>([])
  // Review ids whose send response was lost, or whose approval the server refused as no longer valid.
  const [lostSendIds, setLostSendIds] = useState<readonly string[]>([]),
    [invalidIds, setInvalidIds] = useState<readonly string[]>([])
  const addId = (ids: readonly string[], id: string) =>
    ids.includes(id) ? ids : [...ids, id]
  const settleSend = (id: string) =>
    setLostSendIds((ids) => ids.filter((item) => item !== id))
  const { busy, active, activate, error, run, invalidate, clearError } =
    useVerificationAction(locationId, "complete")
  const current = useGoogleVerificationState(locationId, false)
  function runReview(
    action: () => Promise<void>,
    targetId = review?.changeSet.id
  ) {
    return run(async () => {
      try {
        await action()
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "approval_expired" &&
          targetId
        )
          setExpiredIds((ids) =>
            ids.includes(targetId) ? ids : [...ids, targetId]
          )
        if (
          error instanceof ApiClientError &&
          error.status === 409 &&
          [
            "approval_expired",
            "approval_policy_changed",
            "approval_stale",
            "approval_actor_access_changed",
            "verification_pin_changed",
            "verification_state_changed",
            "google_target_changed",
            "verification_not_pending",
          ].includes(error.code)
        ) {
          setFreshReviewRequired(true)
          if (targetId && error.code !== "approval_expired")
            setInvalidIds((ids) => addId(ids, targetId))
        }
        throw error
      }
    })
  }
  function reset() {
    setReview(null)
    setAttempt(null)
    setFreshReviewRequired(false)
    setUncertain(false)
    clearError()
  }
  const pending = (current.data?.verifications ?? verifications).filter(
    (item) => item.phase === "pending"
  )
  function checkState() {
    void run(async () => {
      const result = await current.refetch()
      if (result.error) throw result.error
    })
  }
  // Google's requests were never read (or the read failed with nothing
  // earlier to show): say so, rather than "no request is waiting".
  const panelOpen = Boolean(attempt || review)
  const unreadable =
    !panelOpen && !pending.length && current.isError && !current.data
  const errorNote = error && (
    <p role="alert" className="text-ui text-danger-ink">
      {error}
    </p>
  )
  const stateCheck = (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        variant="secondary"
        className="h-auto min-h-(--np-control-h) max-w-full self-start py-2 text-left leading-snug whitespace-normal"
        disabled={busy}
        onClick={checkState}
      >
        Check current Google verification state
      </Button>
      {current.data && (
        <p className="text-caption text-ink-muted">
          Current requests last checked{" "}
          <Instant value={current.data.checkedAt} />.
        </p>
      )}
      {current.isError && !unreadable && (
        <p role="status" className="text-ui text-ink-secondary">
          Current Google state could not be refreshed. Any request details still
          shown are earlier observations.
        </p>
      )}
    </div>
  )
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {attempt || review ? (
        <ReviewedWritePanel
          id="verification-pin-review"
          headingLevel="h3"
          title={attempt ? "PIN completion outcome" : "Review PIN completion"}
          stage={reviewedWriteStage({
            approved: Boolean(review?.changeSet.approvedBy),
            recorded: Boolean(attempt),
          })}
          secondApprover={review?.changeSet.requiresSecondApprover}
          focusKey={
            attempt
              ? `attempt:${attempt.id}`
              : review
                ? `review:${review.changeSet.id}`
                : null
          }
        >
          {attempt ? (
            <>
              <VerificationAttemptStatus
                attempt={attempt}
                busy={busy}
                onRefresh={() =>
                  void run(async () => {
                    setAttempt(
                      await refreshGoogleVerificationCompletionAttempt(
                        locationId,
                        attempt.reviewId
                      )
                    )
                    invalidate()
                  })
                }
                onState={checkState}
              />
              {(attempt.error === "completion_rejected" ||
                attempt.verification?.phase === "failed") && (
                <Button
                  variant="ghost"
                  className="h-auto min-h-(--np-control-h) max-w-full self-start py-2 text-left leading-snug whitespace-normal"
                  disabled={busy}
                  onClick={() => {
                    // Back to the PIN list, then a read-only check of Google.
                    reset()
                    checkState()
                  }}
                >
                  Check Google, then review a corrected PIN
                </Button>
              )}
            </>
          ) : review ? (
            <VerificationCompletionReview
              key={`${review.changeSet.id}:${review.changeSet.approvedBy}:${reviewVersion}:${active}`}
              review={review}
              busy={busy}
              active={active}
              onActivate={activate}
              blocked={writeBlocked}
              uncertain={uncertain || lostSendIds.includes(review.changeSet.id)}
              freshReviewRequired={
                freshReviewRequired || invalidIds.includes(review.changeSet.id)
              }
              reportedExpired={expiredIds.includes(review.changeSet.id)}
              onApprove={() =>
                void runReview(async () => {
                  setReview(
                    await approveGoogleVerificationCompletion(
                      locationId,
                      review.changeSet.id,
                      review.changeSet.payloadHash
                    )
                  )
                  activate()
                  invalidate()
                })
              }
              onExecute={(pin) =>
                void runReview(async () => {
                  setUncertain(true)
                  try {
                    setAttempt(
                      await executeGoogleVerificationCompletion(
                        locationId,
                        review.changeSet.id,
                        review.changeSet.payloadHash,
                        pin
                      )
                    )
                    setUncertain(false)
                    settleSend(review.changeSet.id)
                    invalidate()
                  } catch (error) {
                    if (
                      error instanceof ApiClientError &&
                      error.status >= 400 &&
                      error.status < 500
                    ) {
                      setUncertain(false)
                      if (
                        [
                          "verification_pin_changed",
                          "approval_stale",
                          "verification_state_changed",
                          "google_target_changed",
                          "verification_not_pending",
                        ].includes(error.code)
                      ) {
                        setFreshReviewRequired(true)
                        setInvalidIds((ids) => addId(ids, review.changeSet.id))
                      }
                    } else
                      setLostSendIds((ids) => addId(ids, review.changeSet.id))
                    throw error
                  }
                })
              }
              onCheck={() =>
                void runReview(async () => {
                  try {
                    setAttempt(
                      await fetchGoogleVerificationCompletionAttempt(
                        locationId,
                        review.changeSet.id
                      )
                    )
                    settleSend(review.changeSet.id)
                  } catch (error) {
                    if (
                      !(error instanceof ApiClientError) ||
                      error.status !== 404
                    )
                      throw error
                    setUncertain(false)
                    settleSend(review.changeSet.id)
                    setReview(
                      await fetchGoogleVerificationCompletionReview(
                        locationId,
                        review.changeSet.id
                      )
                    )
                    setReviewVersion((version) => version + 1)
                  }
                  setUncertain(false)
                  invalidate()
                })
              }
              onRefresh={() =>
                void runReview(async () => {
                  setReview(
                    await fetchGoogleVerificationCompletionReview(
                      locationId,
                      review.changeSet.id
                    )
                  )
                  setReviewVersion((version) => version + 1)
                })
              }
              onReset={reset}
            />
          ) : null}
          {errorNote}
        </ReviewedWritePanel>
      ) : (
        <>
          {/* "No request" is a claim about Google, so it needs an observation. */}
          {pending.length ? null : current.data ? (
            <p className="text-ui text-ink-muted">
              Google has no PIN request waiting for this listing. Check Google
              again, or look at saved PIN reviews below.
            </p>
          ) : unreadable ? (
            <p role="status" className="text-ui text-ink-secondary">
              Google’s PIN requests can’t be read right now. Check Google again
              before entering a PIN.
            </p>
          ) : current.isFetching ? (
            <p role="status" className="text-ui text-ink-muted">
              Reading PIN requests from Google…
            </p>
          ) : null}
          {/* A pending request is a list row that carries its own PIN form, so
          the row itself is not a target (`interactive={false}`). */}
          <div
            className={cn(
              pending.length
                ? "rounded-(--np-radius-card) border border-line bg-surface"
                : "contents"
            )}
          >
            <ListRows aria-label="Pending verification requests">
              {pending.map((item) => {
                const supported =
                  verificationCompletionPayloadSchema.shape.method.safeParse(
                    item.method
                  ).success &&
                  verificationCompletionInputSchema.shape.name.safeParse(
                    item.name
                  ).success
                return (
                  <ListRow
                    key={item.name}
                    interactive={false}
                    emphasis="neutral"
                    title={verificationMethodName(item.method)}
                    trailing={
                      <StatusPill tone="pending">
                        Pending with Google
                      </StatusPill>
                    }
                    subtitle={
                      <span className="block whitespace-normal">
                        {verificationRequestDescription(
                          item.method,
                          item.createTime
                        )}
                      </span>
                    }
                    tags={
                      <span className="mt-2 flex w-full min-w-0 flex-col gap-3">
                        <VerificationMethodCode method={item.method} />
                        {supported ? (
                          <VerificationPinField
                            name={item.name}
                            method={item.method}
                            blocked={writeBlocked}
                            busy={busy}
                            onSubmit={(pin) =>
                              void run(async () => {
                                setReview(
                                  await previewGoogleVerificationCompletion(
                                    locationId,
                                    { name: item.name, pin }
                                  )
                                )
                                activate()
                                setFreshReviewRequired(false)
                                setUncertain(false)
                                invalidate()
                              })
                            }
                          />
                        ) : (
                          <span className="block text-ui text-ink-secondary">
                            This pending method cannot accept a PIN here. Follow
                            the instructions in Google, then refresh its state.
                          </span>
                        )}
                        <VerificationRequestReference name={item.name} />
                      </span>
                    }
                  />
                )
              })}
            </ListRows>
          </div>
          {errorNote}
          {stateCheck}
          <a
            href="https://business.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "self-start")}
          >
            Continue verification in Google
          </a>
        </>
      )}
      {attempt || review ? stateCheck : null}
      <SectionGateNote />
      <SavedVerificationWorkflows
        locationId={locationId}
        operation="complete"
        busy={busy}
        expiredReviewIds={expiredIds}
        lostSendReviewIds={lostSendIds}
        invalidReviewIds={invalidIds}
        onSelect={(item) =>
          void runReview(async () => {
            if (item.attempt) {
              const saved = await fetchGoogleVerificationCompletionAttempt(
                locationId,
                item.reviewId
              )
              setAttempt(saved)
              setReview(null)
              settleSend(item.reviewId)
            } else {
              const saved = await fetchGoogleVerificationCompletionReview(
                locationId,
                item.reviewId
              )
              setReview(saved)
              setAttempt(null)
              setReviewVersion((version) => version + 1)
            }
            activate()
            setUncertain(false)
            setFreshReviewRequired(false)
          }, item.reviewId)
        }
      />
    </div>
  )
}
