"use client"

import { useState } from "react"
import {
  ConsentSlot,
  Expiry,
  Instant,
  ReviewedWritePanel,
  reviewedWriteStage,
  SendBar,
  SummaryList,
  type SummaryRow,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import {
  confirmationMatches,
  TypedConfirmation,
} from "@/components/ui/typed-confirmation"
import { useDeadline } from "@/lib/editors/use-deadline"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import type { LifecycleBlock, useLifecycle } from "./use-lifecycle"

function roleText(role: string | null | undefined) {
  return role ? adminRoleLabel(role) : "Role unknown"
}

function blockMessage(
  block: LifecycleBlock | null,
  expired: boolean,
  transfer: boolean,
  approved: boolean
): string {
  if (expired || block === "expired")
    return `This ${approved ? "approval" : "review"} has expired, so the request can no longer be ${approved ? "sent" : "approved"}. Start a fresh review to check Google again.`
  if (block === "destination_changed")
    return "The destination account's access on Google changed since this review, so the reviewed destination role is no longer current. Start a fresh review to check it again."
  if (block === "access_changed")
    return transfer
      ? "The destination or source account's access on Google changed since this review, so the reviewed roles are no longer current. Start a fresh review to check them again."
      : "Google account access or location membership changed since this review. Start a fresh review to check it again."
  return "This review no longer matches Google. Start a fresh review before sending."
}

export function LifecycleReview({
  workflow,
  locationName,
  disabled,
  focusKey,
}: {
  readonly workflow: ReturnType<typeof useLifecycle>
  readonly locationName: string
  readonly disabled: boolean
  /** Moves focus to the panel when a review opens (see ReviewedWritePanel). */
  readonly focusKey?: string | null
}) {
  const review = workflow.review
  const clockExpired = useDeadline(
    review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z"
  )
  const token = `${review?.changeSet.id}:${review?.changeSet.approvedBy}:${workflow.revision}:${disabled}`
  const [key, setKey] = useState(token),
    [consent, setConsent] = useState(false),
    [typedName, setTypedName] = useState("")
  if (key !== token) {
    setKey(token)
    setConsent(false)
    setTypedName("")
  }
  if (!review) return null
  const transfer = review.request.operation === "transfer_location"
  const approved = Boolean(review.changeSet.approvedBy)
  const reportedExpired = workflow.block === "expired"
  const expired = clockExpired || reportedExpired
  // Once access drift is reported, the reviewed roles are a record of the
  // review, not Google's current state.
  const drifted =
    workflow.block === "destination_changed" ||
    workflow.block === "access_changed"
  const reviewedRole = (role: string | null | undefined) =>
    drifted ? `${roleText(role)} at review, no longer current` : roleText(role)
  const blocked =
    disabled ||
    workflow.busy ||
    workflow.stale ||
    expired ||
    workflow.unresolved
  const listingName = review.changeSet.locationName || locationName
  // Exact (trimmed) match: for a lifecycle request the name is the evidence
  // that the person is looking at the right listing. The send route takes only
  // the saved payload hash; this is client-side friction.
  const nameMatches = confirmationMatches(typedName, locationName, "exact")
  const rows: SummaryRow[] = [
    { label: "Location", value: listingName || "Name unavailable" },
    {
      label: "Source account",
      value: `${review.baseline.source.account.name} · ${transfer ? reviewedRole(review.baseline.source.account.role) : roleText(review.baseline.source.account.role)}`,
    },
    ...(review.request.operation === "transfer_location"
      ? [
          {
            label: "Destination account",
            value: `${review.request.payload.destinationAccount} · ${reviewedRole(review.baseline.destination?.account.role)}`,
          },
        ]
      : []),
    {
      label: "Identity checked",
      value: (
        <>
          Checked on Google <Instant value={review.baseline.observedAt} />
        </>
      ),
    },
    {
      label: "Google location",
      value: review.baseline.location.name,
      technical: true,
    },
    {
      label: "Google place ID",
      value: review.baseline.location.placeId ?? "not supplied",
      technical: true,
    },
  ]
  const sendStatus = workflow.uncertain
    ? "Read the saved outcome before sending again."
    : workflow.stale || expired
      ? "This request can no longer be sent."
      : disabled
        ? "Sending is paused until the other Google change is resolved."
        : !locationName
          ? "The listing name is unavailable, so this can’t be confirmed."
          : !nameMatches
            ? "Type the listing name exactly to confirm."
            : !consent
              ? "Tick the box to send this exact request."
              : "Ready to send once to Google. This can’t be undone here."
  return (
    <ReviewedWritePanel
      id="lifecycle-review-title"
      tone="danger"
      title={`Review ${transfer ? "account transfer" : "managed-location deletion"}`}
      description="Approval records this exact request. Sending is a separate action and can change your management access."
      stage={reviewedWriteStage({ approved, recorded: false })}
      secondApprover={review.changeSet.requiresSecondApprover}
      focusKey={focusKey}
    >
      <SummaryList rows={rows} aria-label="Reviewed lifecycle request" />
      {/* The server refused an expiry the local clock had not reached: say when
        that was reported rather than the earlier, future-looking deadline. */}
      <Expiry
        expiresAt={review.changeSet.expiresAt}
        approved={approved}
        clockExpired={clockExpired}
        reportedExpired={reportedExpired}
        reportedAt={workflow.blockedAt}
      />
      {!transfer ? (
        <p className="text-ui text-ink-secondary">
          This requests deletion of the managed Business Profile location. It
          does not guarantee removal from Search or Maps; customer reviews may
          remain.
        </p>
      ) : null}
      {expired || workflow.stale ? (
        <div className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-card) border border-line p-3">
          <p role="status" className="text-ui text-danger-ink">
            {blockMessage(workflow.block, expired, transfer, approved)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || workflow.busy || workflow.unresolved}
            pending={workflow.busy}
            onClick={workflow.refreshReview}
          >
            Start a fresh review
          </Button>
        </div>
      ) : null}
      {review.changeSet.requiresSecondApprover && !approved ? (
        <p className="text-ui text-ink-secondary">
          A different current owner or administrator must approve this exact
          request.
        </p>
      ) : null}
      {workflow.uncertain ? (
        <p role="status" className="text-ui text-ink-secondary">
          The send response is unavailable. Read the saved outcome before
          another lifecycle write.
        </p>
      ) : null}
      {approved && !workflow.uncertain ? (
        <ConsentSlot
          label="Send this exact approved lifecycle request to Google."
          checked={consent}
          onCheckedChange={setConsent}
          disabled={blocked}
        >
          <TypedConfirmation
            match="exact"
            expected={locationName}
            label={`Type the listing name: ${locationName || "Name unavailable"}`}
            value={typedName}
            onValueChange={setTypedName}
            disabled={blocked}
          />
        </ConsentSlot>
      ) : null}
      {/* Stays mounted (disabled) while a send's answer is unknown, so the
          send control never jumps around while the outcome is read. */}
      {approved ? (
        <SendBar label="Approved lifecycle request actions" status={sendStatus}>
          <Button
            variant="danger"
            disabled={blocked || !consent || !nameMatches}
            pending={workflow.busy}
            onClick={workflow.execute}
          >
            Send approved {transfer ? "transfer" : "deletion"}
          </Button>
        </SendBar>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {workflow.uncertain ? (
          <Button
            variant="secondary"
            disabled={workflow.busy}
            onClick={() => workflow.check()}
          >
            Read saved lifecycle outcome
          </Button>
        ) : !approved ? (
          <Button
            disabled={blocked || !review.changeSet.canApprove}
            pending={workflow.busy}
            onClick={workflow.approve}
          >
            Approve lifecycle request
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={workflow.busy || workflow.unresolved}
          onClick={workflow.reset}
        >
          Keep this location unchanged
        </Button>
      </div>
    </ReviewedWritePanel>
  )
}
