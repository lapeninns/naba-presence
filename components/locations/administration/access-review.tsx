"use client"

import { useState } from "react"
import { z } from "zod"
import {
  ConsentSlot,
  Expiry,
  Instant,
  SendBar,
  SummaryList,
  type SummaryRow,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { useDeadline } from "@/lib/editors/use-deadline"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import {
  IDENTIFIER_INPUT_PROPS,
  typedNameMatches,
} from "@/lib/locations/forms/administration"
import { accessTargetDescription } from "./access-target"

export const ACCESS_OPERATION_LABELS = {
  create_admin: "Invite administrator",
  update_admin: "Change administrator role",
  delete_admin: "Remove administrator",
  accept_invitation: "Accept invitation",
  decline_invitation: "Decline invitation",
}

const listedRows = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
})

/** Google's rows saved with a review (what the access looked like when it was checked). */
export function reviewedRows(
  baseline: unknown
): Array<Record<string, unknown>> {
  const parsed = listedRows.safeParse(baseline)
  return parsed.success ? parsed.data.rows : []
}

export function AccessReview({
  review,
  locationName,
  busy,
  blocked,
  uncertain,
  stale,
  onApprove,
  onExecute,
  onCheck,
  onBack,
}: {
  review: AdministrationAccessReview
  locationName: string
  busy: boolean
  blocked: boolean
  uncertain: boolean
  stale: boolean
  onApprove: () => void
  onExecute: () => void
  onCheck: () => void
  onBack: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [typedName, setTypedName] = useState("")
  const expired = useDeadline(review.changeSet.expiresAt)
  const request = review.request,
    payload = request.payload,
    change = review.changeSet
  const listed = reviewedRows(change.baseline)
  const rows: SummaryRow[] = [
    { label: "Listing", value: change.locationName },
    { label: "Action", value: ACCESS_OPERATION_LABELS[request.operation] },
    { label: "Google target", value: accessTargetDescription(request, listed) },
  ]
  const previous =
    "name" in payload
      ? listed.find((row) => row.name === payload.name)
      : undefined
  const invitation =
    request.operation === "accept_invitation" ||
    request.operation === "decline_invitation"
  if (previous) {
    // An invitation's role is what Google offers, not access anyone holds yet.
    rows.push({
      label: invitation ? "Invited role" : "Current role",
      value:
        typeof previous.role === "string"
          ? adminRoleLabel(previous.role)
          : "Not supplied by Google",
    })
    if (typeof previous.admin === "string")
      rows.push({ label: "Current administrator", value: previous.admin })
    if (typeof previous.pendingInvitation === "boolean")
      rows.push({
        label: "Current invitation",
        value: previous.pendingInvitation
          ? "Acceptance pending"
          : "No pending administrator invitation",
      })
  }
  if ("scope" in payload)
    rows.push(
      {
        label: "Scope",
        value:
          payload.scope === "account"
            ? "Whole Google account"
            : "This Google location",
      },
      { label: "Invitee", value: payload.admin ?? payload.account ?? "Unknown" }
    )
  if ("role" in payload)
    rows.push({ label: "Proposed role", value: adminRoleLabel(payload.role) })
  rows.push({
    label: "Observed by Google",
    value: <Instant value={review.observedAt} />,
  })
  rows.push({
    label: "Google reference",
    value: review.target,
    technical: true,
  })

  // Removing someone's access is the destructive access request: its send
  // step asks for the listing name as well as the consent (one rule for every
  // destructive send, see typedNameMatches).
  const destructive = request.operation === "delete_admin"
  const expectedName = change.locationName || locationName
  const nameMatches = !destructive || typedNameMatches(typedName, expectedName)
  const sendLocked = busy || blocked || uncertain
  const sendStatus = uncertain
    ? "Read the saved outcome before sending again."
    : blocked
      ? "Sending is paused. See the reason above."
      : destructive && !expectedName.trim()
        ? "The listing name is unavailable, so this removal can’t be confirmed."
        : !nameMatches
          ? "Type the listing name to confirm the removal."
          : !confirmed
            ? "Tick the box to send this exact request."
            : "Ready to send once to Google."

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SummaryList rows={rows} aria-label="Reviewed access request" />
      <Expiry
        expiresAt={change.expiresAt}
        approved={Boolean(change.approvedBy)}
        clockExpired={expired}
      />
      {expired || stale ? (
        <p role="alert" className="text-ui text-danger-ink">
          This review cannot be sent. Check current Google state and create a
          fresh review.
        </p>
      ) : !change.approvedBy ? (
        <>
          <p className="text-ui text-ink-secondary">
            {change.requiresSecondApprover
              ? "A different authorised owner or admin must approve this request. They can open it under Saved access work."
              : "Approve this exact request before sending it."}
          </p>
          <Button
            className="self-start"
            disabled={busy || blocked || !change.canApprove}
            onClick={onApprove}
          >
            Approve access request
          </Button>
        </>
      ) : (
        <>
          <p role="status" className="text-ui text-ink">
            This exact access request is approved.
          </p>
          <ConsentSlot
            label="Send this exact approved access change to Google."
            checked={confirmed}
            onCheckedChange={setConfirmed}
            disabled={sendLocked}
          >
            {destructive ? (
              <Field>
                <FieldLabel htmlFor="access-typed-name">
                  Type the listing name: {expectedName || "Name unavailable"}
                </FieldLabel>
                <Input
                  id="access-typed-name"
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  disabled={sendLocked}
                  {...IDENTIFIER_INPUT_PROPS}
                />
              </Field>
            ) : null}
          </ConsentSlot>
          <SendBar label="Approved access request actions" status={sendStatus}>
            <Button
              variant={destructive ? "danger" : "default"}
              disabled={sendLocked || !confirmed || !nameMatches}
              pending={busy}
              onClick={onExecute}
            >
              Send approved access request
            </Button>
          </SendBar>
        </>
      )}
      {uncertain && (
        <p role="status" className="text-ui text-ink-secondary">
          The send response was unavailable. Check the saved outcome before
          taking another action.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCheck}>
          Check saved access outcome
        </Button>
        <Button variant="ghost" disabled={busy || uncertain} onClick={onBack}>
          Back to access
        </Button>
      </div>
    </div>
  )
}
