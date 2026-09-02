"use client"

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

/** One admins sub-resource (`locationAdmins` / `accountAdmins`) as a table with row actions. */
export function AdminsSection({ data }: { data: unknown }) {
  return (
    <AdminsTable
      admins={asArray(asRecord(data).admins).map(toAdminRow)}
      invitations={[]}
      renderActions={(admin) => <AdminRowActions admin={admin} />}
    />
  )
}

function AdminRowActions({ admin }: { admin: AdminRow }) {
  return (
    <div className="flex items-center gap-2">
      <UpdateAdminRoleControl admin={admin} />
      <RemoveAdminAction admin={admin} />
    </div>
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
    <div className="flex items-center gap-2">
      <Select
        value={role}
        onValueChange={(value: string | null) => value && setRole(value)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={`Role for ${admin.admin ?? name}`}>
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
        variant="outline"
        onClick={() => update.mutate()}
        disabled={writeBlocked || role === currentRole || update.isPending}
      >
        {update.isPending ? "Saving…" : "Update role"}
      </Button>
    </div>
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
        variant="destructive"
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
        description={`This removes ${admin.admin ?? "this person"}'s access to manage this business on Google.`}
        expectedName={locationName}
        confirmLabel="Remove administrator"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
