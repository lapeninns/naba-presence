"use client"

import { Fragment, useMemo, useState } from "react"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import {
  ConsentSlot,
  Expiry,
  ReviewedWriteSheet,
  SummaryList,
  reviewedWriteStage,
  useClaimFocus,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { useDeadline } from "@/lib/editors/use-deadline"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import { createAdminSchema } from "@/lib/locations/forms/administration"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { AccessOutcome } from "./access-outcome"
import { accessReviewRows } from "./access-review"
import { EDITABLE_ROLES } from "./admins"
import type { AdministrationSectionContext } from "./context"
import type { useAdministrationAccessController } from "./use-administration-access"

// These are our own UI-level scope values (not a Google enum), but the
// trigger still must not go blank/raw on first paint (spec §7) - factor the
// label here so the SelectValue render-function and the SelectItems below
// can never drift out of sync.
const ADMIN_SCOPE_LABELS: Record<string, string> = {
  location: "This location",
  account: "The whole Google account",
}

// What each choice grants, said at the point of choice so an owner or an
// account-wide invitation is never one unexplained tap away.
const ROLE_HINTS: Record<string, string> = {
  MANAGER:
    "Edits the listing and replies to reviews. Can’t manage people or remove the listing.",
  OWNER:
    "Everything a manager can do, plus managing people and removing the listing.",
}
const SCOPE_HINTS: Record<string, string> = {
  location: "Only this listing.",
  account: "Every listing in this Google account.",
}

const FORM_ID = "invite-form"

type SheetAction = "approve" | "send" | "read" | "refresh"

/**
 * The whole invitation on one sheet: the address, role and scope first, then
 * the saved review with its approval and consent, then the recorded outcome,
 * each with the steps under the title and the one action in the footer.
 * Nothing is sent until the approved review is sent on purpose; the other
 * access changes (role, removal, accept, decline) keep their page panel.
 *
 * The sheet is open while the form is open or while the current review or
 * outcome is an invitation, so a saved invitation opened from "Saved access
 * work" lands here too. Closing it goes back to access, and is refused while
 * the outcome is unresolved, as the panel's own back control is.
 */
export function InviteSheet({
  action,
  section,
  formBlocked,
  open,
  onOpenChange,
}: {
  readonly action: ReturnType<typeof useAdministrationAccessController>
  /** The tab's own section state, not the one composed with the in-progress access gates. */
  readonly section: AdministrationSectionContext
  /** Why the form can't be reviewed right now (the composed publish gate). */
  readonly formBlocked: boolean
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const { review, attempt } = action
  const current = attempt ?? review
  const invitation = current?.request.operation === "create_admin"
  const reviewing = invitation && !attempt ? review : null
  const recorded = invitation && attempt ? attempt : null
  const active = invitation && Boolean(current)
  const sheetOpen = open

  const [scope, setScope] = useState("location")
  const [email, setEmail] = useState("")
  // The address is checked once the person leaves the field or tries to
  // review it, not while it is still being typed.
  const [emailTouched, setEmailTouched] = useState(false)
  const [role, setRole] = useState("MANAGER")
  const [discarding, setDiscarding] = useState(false)
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState<SheetAction | null>(null)
  // The sheet's content mounts after it opens, so the title is held in state
  // and focus is claimed once it exists.
  const [titleElement, setTitleElement] = useState<HTMLSpanElement | null>(null)
  const title = useMemo(() => ({ current: titleElement }), [titleElement])

  // One consent per saved review, and per move between steps.
  const token = `${review?.changeSet.id}:${review?.changeSet.approvedBy}:${action.selectionRevision}:${Boolean(attempt)}`
  const [key, setKey] = useState(token)
  if (key !== token) {
    setKey(token)
    setConsent(false)
    setPending(null)
  }
  // The steps replace one another in place, so the title takes focus on each
  // new one; the focused button would otherwise be gone.
  useClaimFocus(
    title,
    sheetOpen && titleElement ? (active ? token : "form") : null
  )

  const expired = useDeadline(
    review?.changeSet.expiresAt ?? "1970-01-01T00:00:00Z"
  )

  const parsed = createAdminSchema.safeParse({ scope, admin: email, role })
  const emailError =
    emailTouched && email.trim().length > 0 && !parsed.success
      ? parsed.error.issues.find((issue) => issue.path[0] === "admin")?.message
      : undefined

  const create = useResourceMutation({
    mutationFn: () => {
      const values = createAdminSchema.parse({ scope, admin: email, role })
      return action.preview(
        administrationAccessRequestSchema.parse({
          operation: "create_admin",
          payload: values,
        })
      )
    },
    invalidate: [queryKeys.locationAdministration(section.locationId)],
    successToast: "Invitation ready to approve",
    // The review takes the form's place on this same sheet.
    onSuccess: () => {
      setEmail("")
      setEmailTouched(false)
    },
  })

  const cannotSubmit =
    !parsed.success ||
    formBlocked ||
    create.isPending ||
    action.busy ||
    Boolean(action.unresolved)

  const close = () => {
    setEmail("")
    setEmailTouched(false)
    onOpenChange(false)
  }
  // Nothing in flight, so the sheet can close. A settled review or outcome is
  // put away; an unresolved one stays, and the page panel shows it as it did
  // before the sheet, so closing never hides work that still needs a look.
  const back = () => {
    if (action.busy) return
    if (!action.unresolved) action.reset()
    close()
  }
  const dismiss = (next: boolean) => {
    if (next) return onOpenChange(true)
    // A request in flight can't be dismissed: its answer lands on this sheet.
    if (create.isPending || action.busy) return
    if (active) return back()
    if (email.trim().length > 0) setDiscarding(true)
    else close()
  }
  const act = (next: SheetAction, work: () => void) => () => {
    setPending(next)
    work()
  }

  // Sending needs the approval and a separate consent, and a review that has
  // neither expired nor gone stale. The writes are paused or blocked by the
  // tab's own gate, not by the in-progress access that composes it.
  const blocked = section.writeBlocked
  const sendLocked = action.busy || blocked || action.uncertain
  const approved = Boolean(reviewing?.changeSet.approvedBy)
  const cannotSend = Boolean(expired || action.stale)
  const sendStatus = action.uncertain
    ? "Read the saved outcome before sending again."
    : blocked
      ? "Sending is paused. See the reason on the page."
      : !consent
        ? "Tick the box to send this exact request."
        : "Ready to send once to Google."

  const heading = recorded
    ? "Saved invitation outcome"
    : reviewing
      ? "Review invitation"
      : "Invite someone"

  return (
    <>
      <ReviewedWriteSheet
        open={sheetOpen}
        onOpenChange={dismiss}
        title={
          <span
            ref={setTitleElement}
            tabIndex={-1}
            className="outline-none focus-visible:focus-halo"
          >
            {heading}
          </span>
        }
        description={
          recorded
            ? "Recorded request. Nothing is sent again from here."
            : reviewing
              ? "Review this exact target and action. Approval saves permission to send; it does not change access on Google."
              : "Google emails them an invitation. They get access once they accept it on Google. Reviewing sends nothing yet."
        }
        stage={
          recorded
            ? "outcome"
            : reviewing
              ? reviewedWriteStage({ approved, recorded: false })
              : undefined
        }
        secondApprover={reviewing?.changeSet.requiresSecondApprover}
        // One keyed set of buttons per step: a step's buttons are replaced, not
        // eased from one variant into another through low-contrast frames.
        footer={
          recorded ? (
            <Fragment key="outcome">
              <Button
                variant="ghost"
                className="sm:mr-auto"
                disabled={action.busy}
                onClick={back}
              >
                {action.unresolved ? "Close for now" : "Back to access"}
              </Button>
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={act("read", () => action.check())}
              >
                Read saved access outcome
              </Button>
              <Button
                variant="secondary"
                disabled={action.busy || recorded.executionState === "rejected"}
                onClick={act("refresh", () => action.check(true))}
              >
                Refresh Google access state
              </Button>
            </Fragment>
          ) : reviewing ? (
            <Fragment key="review">
              <Button
                variant="ghost"
                className="sm:mr-auto"
                disabled={action.busy}
                onClick={back}
              >
                {action.unresolved ? "Close for now" : "Back to access"}
              </Button>
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={act("read", () => action.check())}
              >
                Check saved access outcome
              </Button>
              {cannotSend ? null : approved ? (
                <Button
                  disabled={sendLocked || !consent}
                  pending={action.busy && pending === "send"}
                  onClick={act("send", action.execute)}
                >
                  Send approved access request
                </Button>
              ) : (
                <Button
                  disabled={
                    action.busy || blocked || !reviewing.changeSet.canApprove
                  }
                  pending={action.busy && pending === "approve"}
                  onClick={act("approve", action.approve)}
                >
                  Approve access request
                </Button>
              )}
            </Fragment>
          ) : (
            <Fragment key="form">
              <Button
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => dismiss(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={FORM_ID}
                disabled={cannotSubmit}
                pending={create.isPending}
                pendingLabel="Reviewing…"
              >
                Review invitation
              </Button>
            </Fragment>
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          {/* Another access change's earlier error belongs on the page, not on a fresh form. */}
          {action.error && (active || create.isError) ? (
            <p role="alert" className="text-ui text-danger-ink">
              {action.error}
            </p>
          ) : null}
          {action.busy || create.isPending ? (
            <p role="status" className="text-ui text-ink-muted">
              {pending === "send"
                ? "Sending… you can close this when it finishes."
                : "Working… you can close this when it finishes."}
            </p>
          ) : null}
          {recorded ? (
            <AccessOutcome
              attempt={recorded}
              review={review}
              busy={action.busy}
              showActions={false}
              onCheck={() => action.check()}
              onRefresh={() => action.check(true)}
              onBack={back}
            />
          ) : reviewing ? (
            <>
              <SummaryList
                rows={accessReviewRows(reviewing)}
                aria-label="Reviewed access request"
              />
              <Expiry
                expiresAt={reviewing.changeSet.expiresAt}
                approved={approved}
                clockExpired={expired}
              />
              {cannotSend ? (
                <p role="alert" className="text-ui text-danger-ink">
                  This review cannot be sent. Check current Google state and
                  create a fresh review.
                </p>
              ) : !approved ? (
                <p className="text-ui text-ink-secondary">
                  {reviewing.changeSet.requiresSecondApprover
                    ? "A different authorised owner or admin must approve this request. They can open it under Saved access work."
                    : "Approve this exact request before sending it."}
                </p>
              ) : (
                <>
                  <p role="status" className="text-ui text-ink">
                    This exact access request is approved.
                  </p>
                  <ConsentSlot
                    label="Send this exact approved access change to Google."
                    checked={consent}
                    onCheckedChange={setConsent}
                    disabled={sendLocked}
                  />
                  <p className="text-ui text-ink-muted">{sendStatus}</p>
                </>
              )}
              {action.uncertain ? (
                <p role="status" className="text-ui text-ink-secondary">
                  The send response was unavailable. Check the saved outcome
                  before taking another action.
                </p>
              ) : null}
            </>
          ) : (
            // A real form: Enter in the email field reviews the invitation,
            // or shows this form's own email error (noValidate: never the
            // browser's bubble).
            <form
              id={FORM_ID}
              noValidate
              className="flex min-w-0 flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                // Enter on an address that isn't valid yet says why.
                setEmailTouched(true)
                if (!cannotSubmit) create.mutate()
              }}
            >
              {/* The footer's button submits this form from outside it; this one
                  keeps Enter in the email field working wherever the form is read. */}
              <button type="submit" hidden tabIndex={-1} />
              <Field error={emailError}>
                <FieldLabel>Email address</FieldLabel>
                <Input
                  {...inputHints.email}
                  // Someone else's address: don't offer the operator's own.
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                />
                <FieldError />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Select
                  value={role}
                  onValueChange={(value: string | null) =>
                    value && setRole(value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(value: string | null) =>
                        value ? adminRoleLabel(value) : ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent title="Role">
                    {EDITABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {adminRoleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{ROLE_HINTS[role]}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Scope</FieldLabel>
                <Select
                  value={scope}
                  onValueChange={(value: string | null) =>
                    value && setScope(value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(value: string | null) =>
                        value ? (ADMIN_SCOPE_LABELS[value] ?? value) : ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent title="Scope">
                    <SelectItem value="location">
                      {ADMIN_SCOPE_LABELS.location}
                    </SelectItem>
                    <SelectItem value="account">
                      {ADMIN_SCOPE_LABELS.account}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>{SCOPE_HINTS[scope]}</FieldDescription>
              </Field>
            </form>
          )}
        </div>
      </ReviewedWriteSheet>
      {/* A typed address is a draft: a stray scrim tap or Escape asks first. */}
      <DiscardDialog
        open={discarding}
        onOpenChange={setDiscarding}
        onConfirm={close}
        announce={false}
      />
    </>
  )
}
