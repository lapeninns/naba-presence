"use client"

import { useState } from "react"

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
import { ChoiceCard } from "@/components/ui/choice-card"
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
import { RadioGroup } from "@/components/ui/radio-group"
import { StatusPill } from "@/components/ui/status-pill"
import type { Member } from "@/lib/api/members"
import { roleOptionsFor } from "@/lib/settings/gating"
import { roleLabel, type MemberRole } from "@/lib/settings/forms/invitation"
import { ROLE_DESCRIPTIONS, roleWithArticle } from "@/lib/settings/roles"

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/**
 * The four roles as selectable cards (reference `.role-cards`): the role in
 * words, what it allows, and "Usual choice" on Member. Two columns while the
 * container has room, one on a phone. Owner is left out for a non-owner
 * actor (server: assertRoleChangeAllowed).
 */
export function RoleCards({
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
  return (
    <div className="@container/roles">
      <RadioGroup
        value={value}
        onValueChange={(next) => onValueChange(next as MemberRole)}
        aria-labelledby={labelledBy}
        disabled={disabled}
        className="grid grid-cols-1 gap-2 @[30rem]/roles:grid-cols-2"
      >
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            value={option.value}
            title={option.label}
            description={ROLE_DESCRIPTIONS[option.value]}
          >
            {option.value === "member" ? (
              <StatusPill tone="accent" plain className="mt-1.5">
                Usual choice
              </StatusPill>
            ) : null}
          </ChoiceCard>
        ))}
      </RadioGroup>
    </div>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        {member ? (
          <ChangeRoleBody
            key={member.userId}
            member={member}
            actorRole={actorRole}
            pending={pending}
            error={error}
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
  onConfirm,
}: {
  member: Member
  actorRole: MemberRole
  pending: boolean
  error: string | null
  onConfirm: (role: MemberRole) => void
}) {
  const [pick, setPick] = useState<MemberRole>(member.role)
  const unchanged = pick === member.role
  const name = member.displayName
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change role</DialogTitle>
        <DialogDescription>
          {name} is {roleWithArticle(member.role)}. Choose what they can do
          across your clients.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <RoleCards
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
          <p className="text-caption text-ink-muted">
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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        <AlertDialogTitle className="[overflow-wrap:anywhere]">Remove {name} from the team?</AlertDialogTitle>
        <AlertDialogDescription>
          {member
            ? `${name} (${roleLabel(member.role)}) loses access to every client straight away. To bring them back, send them a new invitation.`
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
