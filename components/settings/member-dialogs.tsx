"use client"

import type * as React from "react"
import { useState } from "react"

import { firstName } from "@/components/settings/access-scope-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { StatusPill } from "@/components/ui/status-pill"
import { isMfaStepUpError } from "@/lib/api/client"
import type { Member } from "@/lib/api/members"
import { MFA_ENROLLMENT_REQUIRED } from "@/lib/contracts/wire-codes"
import { describeActionError } from "@/lib/errors/action-errors"
import { roleOptionsFor } from "@/lib/settings/gating"
import { roleLabel, type MemberRole } from "@/lib/settings/forms/invitation"
import {
  roleDescriptions,
  roleSummaries,
  roleWithArticle,
} from "@/lib/settings/roles"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { workspaceTerms } from "@/lib/workspace/terms"

/**
 * A member change's refusal, in words. A 403 asking for two-step
 * verification opens a prompt (lib/api/client.ts): "Confirm it’s you" when
 * a code is due, "Set up two-step verification" when none is set up yet.
 * The dialog names the same next step instead of blaming permissions;
 * nothing was saved either way.
 */
export function describeMemberError(error: unknown): string {
  if (!isMfaStepUpError(error)) return describeActionError(error)
  return error.code === MFA_ENROLLMENT_REQUIRED
    ? "Set up two-step verification first, then try again. Nothing was changed."
    : "Confirm it’s you with your two-step code, then try again. Nothing was changed."
}

/**
 * The roles as compact radio rows, in the order Member, Viewer, Admin, Owner
 * (ROLE_CHOICE_ORDER): the role in words with a one-line sub-label, and
 * "Usual choice" on Member. The selected row spells out in full what the
 * role allows. Owner is left out for a non-owner actor (server:
 * assertRoleChangeAllowed).
 */
export function RolePicker({
  actorRole,
  value,
  onValueChange,
  disabled,
  labelledBy,
}: {
  actorRole: MemberRole
  value: MemberRole
  onValueChange: (role: MemberRole) => void
  disabled?: boolean
  labelledBy?: string
}) {
  const options = roleOptionsFor(actorRole)
  const mode = useWorkspaceMode()
  const full = roleDescriptions(mode)
  const summaries = roleSummaries(mode)
  return (
    <OptionRowGroup
      aria-labelledby={labelledBy}
      label={labelledBy ? undefined : "Role"}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <OptionRow
            key={option.value}
            indicator="radio"
            selected={selected}
            disabled={disabled}
            label={
              option.value === "member" ? (
                <>
                  {option.label}
                  <StatusPill
                    tone="accent"
                    plain
                    aria-hidden="true"
                    className="ms-2"
                  >
                    Usual choice
                  </StatusPill>
                </>
              ) : (
                option.label
              )
            }
            description={
              <>
                {option.value === "member"
                  ? `${selected ? full.member : summaries.member} `
                  : selected
                    ? full[option.value]
                    : summaries[option.value]}
                {option.value === "member" ? (
                  <span className="sr-only">This is the usual choice.</span>
                ) : null}
              </>
            }
            onClick={() => onValueChange(option.value)}
          />
        )
      })}
    </OptionRowGroup>
  )
}

/**
 * Change one member's role. Opened only for a member whose role the actor
 * may change (the menu item carries the reason otherwise); the server still
 * decides, and a refusal is shown here with the dialog left open.
 */
export function ChangeRoleDialog({
  open,
  member,
  actorRole,
  actorUserId,
  pending,
  error,
  onOpenChange,
  onConfirm,
  onPick,
  finalFocus,
}: {
  open: boolean
  /** Kept after close so the popup does not empty while it animates out. */
  member: Member | null
  actorRole: MemberRole
  /** The signed-in user: their own row is worded "you" and warns first. */
  actorUserId?: string
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (role: MemberRole) => void
  /** Told about every new pick (the table clears a stale refusal). */
  onPick?: (role: MemberRole) => void
  /**
   * Where focus goes when it closes; by default, back to what opened it.
   * Pass it when the opener is gone (a member sheet that handed over).
   */
  finalFocus?: React.RefObject<HTMLElement | null>
}) {
  // A role picked but not saved: an accidental dismissal asks first.
  // Cleared whenever the dialog closes, however it closed (a saved change
  // closes it from the table).
  const [dirty, setDirty] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setDirty(false)
  }
  const self = member !== null && member.userId === actorUserId
  return (
    <Dialog
      open={open}
      dirty={dirty}
      onOpenChange={onOpenChange}
      discardPrompt={{
        description: self
          ? "The new role hasn’t been saved. Your role stays as it was."
          : "The new role hasn’t been saved. Their role stays as it was.",
      }}
    >
      <DialogContent
        className="grid-cols-[minmax(0,1fr)]"
        finalFocus={finalFocus}
      >
        {member ? (
          <ChangeRoleBody
            key={member.userId}
            member={member}
            actorRole={actorRole}
            self={self}
            pending={pending}
            error={error}
            onPick={(role) => {
              setDirty(role !== member.role)
              onPick?.(role)
            }}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ChangeRoleBody({
  member,
  actorRole,
  self,
  pending,
  error,
  onPick,
  onConfirm,
}: {
  member: Member
  actorRole: MemberRole
  self: boolean
  pending: boolean
  error: string | null
  onPick: (role: MemberRole) => void
  onConfirm: (role: MemberRole) => void
}) {
  const [pick, setPickState] = useState<MemberRole>(member.role)
  const setPick = (role: MemberRole) => {
    setPickState(role)
    onPick(role)
  }
  const unchanged = pick === member.role
  const name = member.displayName
  const terms = workspaceTerms(useWorkspaceMode())
  // Your own role: Team is for owners and admins, so a member or viewer
  // can't come back here to undo it (the server allows it; the last-owner
  // rule is the only guard).
  const losesTeam =
    self && !unchanged && (pick === "member" || pick === "viewer")
  // Any lower role takes an owner's ownership away, and only an owner can
  // grant it again (admins never see Owner: roleOptionsFor).
  const losesOwner = self && !unchanged && member.role === "owner"
  const whoCanUndo =
    member.role === "owner" ? "another owner" : "an owner or admin"
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change role</DialogTitle>
        <DialogDescription>
          {self
            ? `You’re ${roleWithArticle(member.role)}. Choose what you can do across your ${terms.scopePlural}.`
            : `${name} is ${roleWithArticle(member.role)}. Choose what they can do across your ${terms.scopePlural}.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <RolePicker
          actorRole={actorRole}
          value={pick}
          onValueChange={setPick}
          disabled={pending}
        />
        {!unchanged && pick === "owner" ? (
          <Alert variant="warning">
            <AlertTitle>Owners can change any role</AlertTitle>
            <AlertDescription>
              {name} will be able to change or remove anyone, including you.
            </AlertDescription>
          </Alert>
        ) : null}
        {losesOwner ? (
          <Alert variant="warning">
            <AlertTitle>You’ll no longer be an owner</AlertTitle>
            <AlertDescription>
              Only another owner can make you an owner again.
            </AlertDescription>
          </Alert>
        ) : null}
        {losesTeam ? (
          <Alert variant="warning">
            <AlertTitle>You’ll lose access to Team</AlertTitle>
            <AlertDescription>
              You won’t be able to manage the team, Google connections or reply
              policy. Only {whoCanUndo} can change your role back.
            </AlertDescription>
          </Alert>
        ) : null}
        {!unchanged && pick === "viewer" ? (
          <p className="text-ui text-ink-muted">
            {self
              ? "Viewers can’t publish, so your publishing access turns off."
              : `Viewers can’t publish, so ${firstName(name)}’s publishing access turns off.`}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>The role wasn’t changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={unchanged}
          pending={pending}
          pendingLabel="Saving…"
          onClick={() => onConfirm(pick)}
        >
          {unchanged
            ? "Change role"
            : self
              ? `Make myself ${roleWithArticle(pick)}`
              : `Make ${firstName(name)} ${roleWithArticle(pick)}`}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Confirm removing someone from the organisation. */
export function RemoveMemberDialog({
  open,
  member,
  pending,
  error,
  onOpenChange,
  onConfirm,
  finalFocus,
}: {
  open: boolean
  member: Member | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  /**
   * Where focus goes when it closes. After a removal the opener (the row's
   * ⋯, a swipe action, the sheet's row) has gone with the row.
   */
  finalFocus?: React.ComponentProps<typeof AlertDialogContent>["finalFocus"]
}) {
  const name = member?.displayName ?? ""
  const terms = workspaceTerms(useWorkspaceMode())
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="grid-cols-[minmax(0,1fr)]"
        finalFocus={finalFocus}
      >
        <AlertDialogTitle className="[overflow-wrap:anywhere]">
          Remove {name} from the team?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {member
            ? `${name} (${roleLabel(member.role)}) loses access to every ${terms.scope} straight away. To bring them back, send them a new invitation.`
            : null}
        </AlertDialogDescription>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{name} wasn’t removed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="ghost">Keep them</Button>}
          />
          <Button
            variant="danger"
            pending={pending}
            pendingLabel="Removing…"
            onClick={onConfirm}
          >
            Remove {firstName(name)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
