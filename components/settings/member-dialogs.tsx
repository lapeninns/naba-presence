"use client"

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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { StatusPill } from "@/components/ui/status-pill"
import type { Member } from "@/lib/api/members"
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
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  /** Kept after close so the popup does not empty while it animates out. */
  member: Member | null
  actorRole: MemberRole
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (role: MemberRole) => void
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
  return (
    <Dialog
      open={open}
      dirty={dirty}
      onOpenChange={onOpenChange}
      discardPrompt={{
        description:
          "The new role hasn’t been saved. Their role stays as it was.",
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        {member ? (
          <ChangeRoleBody
            key={member.userId}
            member={member}
            actorRole={actorRole}
            pending={pending}
            error={error}
            onPick={(role) => setDirty(role !== member.role)}
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
  pending,
  error,
  onPick,
  onConfirm,
}: {
  member: Member
  actorRole: MemberRole
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
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change role</DialogTitle>
        <DialogDescription>
          {name} is {roleWithArticle(member.role)}. Choose what they can do
          across your {terms.scopePlural}.
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
        {!unchanged && pick === "viewer" ? (
          <p className="text-ui text-ink-muted">
            Viewers can’t publish, so {firstName(name)}’s publishing access
            turns off.
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
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button
          disabled={unchanged}
          pending={pending}
          pendingLabel="Saving…"
          onClick={() => onConfirm(pick)}
        >
          {unchanged
            ? "Change role"
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
}: {
  open: boolean
  member: Member | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const name = member?.displayName ?? ""
  const terms = workspaceTerms(useWorkspaceMode())
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
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
