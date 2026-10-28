"use client"

import { Expiry, SummaryList } from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { VerificationCompletionReview as CompletionReview } from "@/lib/contracts/google-verification-completion-review"
import { useDeadline } from "@/lib/editors/use-deadline"
import {
  verificationMethodName,
  verificationRequestDescription,
} from "./verification-method"
import { VerificationPinField } from "./verification-pin-field"

/** The body of a saved PIN completion review; the page's ReviewedWritePanel supplies the heading and steps. */
export function VerificationCompletionReview({
  review,
  busy,
  active,
  blocked,
  uncertain,
  freshReviewRequired,
  reportedExpired = false,
  onActivate,
  onApprove,
  onExecute,
  onCheck,
  onRefresh,
  onReset,
}: {
  readonly review: CompletionReview
  readonly busy: boolean
  readonly blocked: boolean
  readonly uncertain: boolean
  readonly freshReviewRequired: boolean
  readonly onApprove: () => void
  readonly onExecute: (pin: string) => void
  readonly onCheck: () => void
  readonly onRefresh: () => void
  readonly onReset: () => void
  readonly active: boolean
  readonly onActivate: () => void
  /** The server refused this review as expired, even if its recorded deadline has not passed here. */
  readonly reportedExpired?: boolean
}) {
  const change = review.changeSet,
    clockExpired = useDeadline(change.expiresAt),
    expired = clockExpired || reportedExpired
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-ui text-ink-secondary">
        Approving doesn’t send anything. To send, someone with the PIN Google
        sent types it again. It isn’t saved here.
      </p>
      <SummaryList
        aria-label="PIN completion to send"
        rows={[
          { label: "Listing", value: change.locationName },
          {
            label: "Method",
            value: verificationMethodName(review.payload.method),
          },
          {
            label: "Verification request",
            value: verificationRequestDescription(
              review.payload.method,
              review.verification.createTime
            ),
          },
          { label: "Reviewed request phase", value: "Pending with Google" },
          {
            label: "Google reference",
            value: review.payload.name,
            technical: true,
          },
        ]}
      />
      <Expiry
        expiresAt={change.expiresAt}
        approved={Boolean(change.approvedBy)}
        clockExpired={clockExpired}
        reportedExpired={reportedExpired}
      />
      {expired ? (
        <p role="status" className="text-ui text-danger-ink">
          {change.approvedBy
            ? "This PIN approval has expired and the PIN can no longer be submitted."
            : "This PIN review has expired."}{" "}
          Check current Google state before a fresh preview.
        </p>
      ) : freshReviewRequired ? (
        <p role="alert" className="text-ui text-danger-ink">
          The PIN or Google state no longer matches this review. Create a fresh
          PIN review and approval.
        </p>
      ) : !change.approvedBy ? (
        <>
          <p className="text-ui text-ink-secondary">
            {change.requiresSecondApprover
              ? "A different authorised owner or admin must approve this request. They’ll find it under Saved PIN completions, and whoever sends needs the PIN."
              : "Approve this PIN completion before sending it to Google."}
          </p>
          <Button
            className="self-start"
            disabled={busy || blocked || !change.canApprove}
            onClick={onApprove}
          >
            Approve PIN completion
          </Button>
        </>
      ) : !active ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={busy}
          onClick={onActivate}
        >
          Continue approved PIN completion
        </Button>
      ) : (
        <>
          <p role="status" className="text-ui">
            {uncertain && !busy
              ? "The result of sending this approved PIN is unknown. Check the saved PIN outcome before any other action."
              : "This PIN completion is approved."}
          </p>
          <VerificationPinField
            name={review.payload.name}
            method={review.payload.method}
            blocked={blocked || uncertain}
            busy={busy}
            reentry
            consentLabel="Submit the reviewed PIN to this exact Google verification request."
            onSubmit={onExecute}
          />
        </>
      )}
      {uncertain && !busy && (
        <p role="status" className="text-ui text-ink-secondary">
          The send response was unavailable. Check the saved outcome before
          another action. Do not submit another PIN request to bypass it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {/* Only an approved review can have been sent, so only then (or after
        a lost send) is there an outcome to check. */}
        {(change.approvedBy || uncertain) && (
          <Button variant="secondary" disabled={busy} onClick={onCheck}>
            Check saved PIN outcome
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy || uncertain}
          onClick={onRefresh}
        >
          Refresh this review
        </Button>
        <Button variant="ghost" disabled={busy || uncertain} onClick={onReset}>
          Create a fresh PIN review
        </Button>
      </div>
    </div>
  )
}
