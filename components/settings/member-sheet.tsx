"use client"

import { Building2, CalendarDays, Send, Shield } from "lucide-react"
import type * as React from "react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SettingsDestructiveAction,
  SettingsGroup,
  SettingsRow,
} from "@/components/ui/settings-row"
import type { Member } from "@/lib/api/members"
import { roleLabel } from "@/lib/settings/forms/invitation"
import { formatDay } from "@/lib/settings/roles"

/** Everything the sheet says about one member, worked out by the list. */
export type MemberSheetDetail = {
  member: Member
  /** "All clients" and its detail line, in the workspace's words. */
  accessLabel: string
  accessDetail: string | null
  /** The access area's name: "Client access" or "Location access". */
  accessName: string
  publishingLabel: string
  /** Why each control is unavailable, or null when it can be used. */
  roleReason: string | null
  accessReason: string | null
  removeReason: string | null
  publishReason: string | null
  /** The publishing switch's live state, or null when it is not a switch. */
  publishSwitch: {
    checked: boolean
    disabled: boolean
    onCheckedChange: (value: boolean) => void
    /** Saving, saved or failed, said under the switch. */
    status: React.ReactNode
  } | null
}

/**
 * One member, opened from their row on a phone (SET-02): role, client
 * access and publishing as settings rows, when they joined, and Remove
 * last. Role and access open the same dialogs as the desk table's menu,
 * after this sheet closes, so two sheets never stack. Every unavailable
 * control stays visible with its reason under it.
 */
export function MemberSheet({
  open,
  detail,
  onOpenChange,
  onChangeRole,
  onChangeAccess,
  onRemove,
}: {
  open: boolean
  detail: MemberSheetDetail | null
  onOpenChange: (open: boolean) => void
  onChangeRole: (member: Member) => void
  onChangeAccess: (member: Member) => void
  onRemove: (member: Member) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        {detail ? (
          <MemberSheetBody
            detail={detail}
            onChangeRole={onChangeRole}
            onChangeAccess={onChangeAccess}
            onRemove={onRemove}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MemberSheetBody({
  detail,
  onChangeRole,
  onChangeAccess,
  onRemove,
}: {
  detail: MemberSheetDetail
  onChangeRole: (member: Member) => void
  onChangeAccess: (member: Member) => void
  onRemove: (member: Member) => void
}) {
  const { member } = detail
  const role = roleLabel(member.role)
  return (
    <>
      <DialogHeader>
        <DialogTitle className="[overflow-wrap:anywhere]">
          {member.displayName}
        </DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">
          {member.email}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <SettingsGroup label="Access">
          {detail.roleReason === null ? (
            <SettingsRow
              icon={<Shield />}
              label="Role"
              value={role}
              onClick={() => onChangeRole(member)}
            />
          ) : (
            <SettingsRow
              icon={<Shield />}
              label="Role"
              value={role}
              footnote={detail.roleReason}
            />
          )}
          {detail.accessReason === null ? (
            <SettingsRow
              icon={<Building2 />}
              label={detail.accessName}
              description={detail.accessDetail ?? undefined}
              value={detail.accessLabel}
              onClick={() => onChangeAccess(member)}
            />
          ) : (
            <SettingsRow
              icon={<Building2 />}
              label={detail.accessName}
              value={detail.accessLabel}
              footnote={detail.accessReason}
            />
          )}
          {detail.publishSwitch ? (
            <SettingsRow
              icon={<Send />}
              label="Can publish"
              description="Off: drafts only, for someone else to publish."
              checked={detail.publishSwitch.checked}
              disabled={detail.publishSwitch.disabled}
              onCheckedChange={detail.publishSwitch.onCheckedChange}
              footnote={detail.publishSwitch.status}
            />
          ) : (
            <SettingsRow
              icon={<Send />}
              label="Publishing"
              value={detail.publishingLabel}
              footnote={detail.publishReason ?? undefined}
            />
          )}
          <SettingsRow
            icon={<CalendarDays />}
            label="Joined"
            value={formatDay(member.createdAt)}
          />
        </SettingsGroup>
        <SettingsDestructiveAction
          disabled={detail.removeReason !== null}
          footnote={detail.removeReason ?? undefined}
          onClick={() => onRemove(member)}
        >
          Remove from team…
        </SettingsDestructiveAction>
      </DialogBody>
    </>
  )
}
