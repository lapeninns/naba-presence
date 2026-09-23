"use client"

import { LockIcon } from "lucide-react"
import { useState } from "react"

import { DangerZoneDialog } from "@/components/locations/danger-zone-dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runAdministrationOperation } from "@/lib/api/location-administration"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import { updateAdminSchema } from "@/lib/locations/forms/administration"
import {
  asArray,
  asRecord,
  type RawRecord,
} from "@/lib/locations/google-values"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { AdminsTable, type AdminRow } from "./admins-table"
import { useAdministrationSection } from "./context"
import { runDangerZoneOperation } from "./danger-zone"

export const EDITABLE_ROLES = ["OWNER", "MANAGER"] as const

function toAdminRow(record: RawRecord): AdminRow {
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    admin: typeof record.admin === "string" ? record.admin : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
    pendingInvitation:
      typeof record.pendingInvitation === "boolean"
        ? record.pendingInvitation
        : undefined,
  }
}

/**
 * Why a row cannot be changed or removed here, or null. Google keeps exactly
 * one primary owner, and a listing must never be left without an owner.
 */
export function ownerLockReason(
  admin: AdminRow,
  admins: readonly AdminRow[]
): string | null {
  if (admin.role === "PRIMARY_OWNER")
    return "Can’t be removed or changed here: every listing keeps one primary owner."
  const owners = admins.filter(
    (row) => row.role === "OWNER" || row.role === "PRIMARY_OWNER"
  )
  if (admin.role === "OWNER" && owners.length <= 1)
    return "The last owner can’t be removed or made a manager. Make someone else an owner first."
  return null
}

/** One admins sub-resource (`locationAdmins` / `accountAdmins`) as a table with row actions. */
export function AdminsSection({
  data,
  caption,
}: {
  data: unknown
  caption?: string
}) {
  const admins = asArray(asRecord(data).admins).map(toAdminRow)
  return (
    <AdminsTable
      admins={admins}
      invitations={[]}
      caption={caption}
      renderActions={(admin) => {
        const locked = ownerLockReason(admin, admins)
        return locked ? (
          <span className="inline-flex max-w-[22rem] items-start gap-1.5 text-left text-caption text-ink-muted">
            <LockIcon
              className="mt-0.5 size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            {locked}
          </span>
        ) : (
          <AdminRowActions admin={admin} />
        )
      }}
    />
  )
}

function AdminRowActions({ admin }: { admin: AdminRow }) {
  return (
    <>
      <UpdateAdminRoleControl admin={admin} />
      <RemoveAdminAction admin={admin} />
    </>
  )
}

function UpdateAdminRoleControl({ admin }: { admin: AdminRow }) {
  const { locationId, disabled, writeBlocked } = useAdministrationSection()
  const name = admin.name
  const currentRole = admin.role
  const initialRole =
    currentRole && (EDITABLE_ROLES as readonly string[]).includes(currentRole)
      ? currentRole
      : "MANAGER"
  const [role, setRole] = useResetOnRevision(initialRole, initialRole)

  const update = useResourceMutation({
    mutationFn: () => {
      const values = updateAdminSchema.parse({ name, role })
      return runAdministrationOperation(locationId, {
        operation: "update_admin",
        payload: values,
      })
    },
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Administrator role updated",
  })

  // Google does not allow changing the primary owner's role here, and a row
  // without a resource `name` has no safe PATCH target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Select
        value={role}
        onValueChange={(value: string | null) => value && setRole(value)}
        disabled={disabled}
      >
        <SelectTrigger
          className="w-32"
          aria-label={`Role for ${admin.admin ?? name}`}
        >
          <SelectValue>
            {(value: string | null) => (value ? adminRoleLabel(value) : "")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {EDITABLE_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {adminRoleLabel(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => update.mutate()}
        disabled={writeBlocked || role === currentRole || update.isPending}
      >
        {update.isPending ? "Saving…" : "Update role"}
      </Button>
    </span>
  )
}

// This is one of the three destructive Google operations in the danger zone
// (spec §11, D9) - it is deliberately row-level rather than living in the
// danger-zone section, since "which admin" only makes sense in the context
// of that row. It still goes through the same two-layer gate as
// transfer/delete: the DangerZoneDialog's typed-location-name confirmation,
// AND the exact backend confirmation literal (runDangerZoneOperation ->
// runAdministrationOperation attaches ADMINISTRATION_CONFIRMATIONS.delete_admin).
function RemoveAdminAction({ admin }: { admin: AdminRow }) {
  const { locationId, locationName, writeBlocked } = useAdministrationSection()
  const name = admin.name
  const currentRole = admin.role
  const [open, setOpen] = useState(false)

  const remove = useResourceMutation({
    mutationFn: () =>
      runDangerZoneOperation(locationId, "delete_admin", { name }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Administrator removed",
    onSuccess: () => setOpen(false),
  })

  // Same guard as UpdateAdminRoleControl: Google will not let the primary
  // owner be removed here, and a row without a resource `name` has no safe
  // DELETE target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${admin.admin ?? name}`}
        onClick={() => setOpen(true)}
        disabled={writeBlocked || !locationName}
      >
        Remove
      </Button>
      <DangerZoneDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this administrator?"
        description={`${admin.admin ?? "This person"} loses access to manage this business on Google straight away. Replies and edits they already made stay.`}
        expectedName={locationName}
        confirmLabel="Remove administrator"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
