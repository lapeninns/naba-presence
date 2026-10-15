"use client"

import { LockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
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

import { AdminsList, type AdminRow } from "./admins-table"
import { useAdministrationSection } from "./context"
import { StaleRosterPlaceholder, useAdministrationAccess } from "./access-workspace"

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

/** One admins sub-resource (`locationAdmins` / `accountAdmins`) as a list of rows with their actions. */
export function AdminsSection({
  data,
  caption,
  scope = "location",
}: {
  data: unknown
  caption?: string
  scope?: "location" | "account"
}) {
  const admins = asArray(asRecord(data)[scope === "account" ? "accountAdmins" : "admins"]).map(toAdminRow)
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  // Rows read before a confirmed change no longer describe Google; never show
  // them as current access while the list is read again.
  if (rosterUpdating || rosterUnavailable)
    return <StaleRosterPlaceholder what={scope === "account" ? "account admins" : "people with access"} />
  return (
    <AdminsList
      admins={admins}
      caption={caption}
      renderActions={(admin) => {
        const locked = ownerLockReason(admin, admins)
        return locked ? (
          <span className="inline-flex max-w-sm min-w-0 items-start gap-1.5 text-left text-caption text-ink-muted">
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

/**
 * The row's role as one control: choosing a different role saves a review of
 * that exact change straight away (nothing is sent; the review opens at the
 * top of the page and takes focus). The select otherwise shows Google's
 * listed role.
 */
function UpdateAdminRoleControl({ admin }: { admin: AdminRow }) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const access = useAdministrationAccess()
  const name = admin.name
  const currentRole = admin.role
  const initialRole =
    currentRole && (EDITABLE_ROLES as readonly string[]).includes(currentRole)
      ? currentRole
      : "MANAGER"
  // A role chosen for review is carried by the saved review, so a new
  // selection, a confirmed change or a newer Google list puts the select
  // back on the listed role rather than leaving a reviewed-but-unlisted role
  // beside the listed badge.
  const [role, setRole] = useResetOnRevision(
    initialRole,
    `${initialRole}:${access.selectionRevision}:${access.confirmedAt ?? ""}`
  )

  const update = useResourceMutation({
    mutationFn: (next: string) => {
      const values = updateAdminSchema.parse({ name, role: next })
      return access.preview(administrationAccessRequestSchema.parse({
        operation: "update_admin",
        payload: values,
      }))
    },
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Administrator role review saved",
    // Nothing was saved: show Google's listed role again.
    onError: () => setRole(initialRole),
  })

  // Google does not allow changing the primary owner's role here, and a row
  // without a resource `name` has no safe PATCH target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <Select
      value={role}
      onValueChange={(value: string | null) => {
        if (!value || value === role) return
        setRole(value)
        if (value !== currentRole) update.mutate(value)
      }}
      disabled={writeBlocked || update.isPending || access.busy || Boolean(access.unresolved)}
    >
      <SelectTrigger
        className="w-36"
        aria-label={`Role for ${admin.admin ?? name}`}
      >
        <SelectValue>
          {(value: string | null) => (value ? adminRoleLabel(value) : "")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent title={`Role for ${admin.admin ?? name}`}>
        {EDITABLE_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {adminRoleLabel(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Starts the removal review. Creating a review sends nothing, so there is no
 * confirmation here: the typed listing name is asked for at the review's
 * send step, where the removal would actually reach Google.
 */
function RemoveAdminAction({ admin }: { admin: AdminRow }) {
  const { locationId, locationName, writeBlocked } = useAdministrationSection()
  const access = useAdministrationAccess()
  const name = admin.name
  const currentRole = admin.role

  const remove = useResourceMutation({
    mutationFn: () =>
      access.preview(administrationAccessRequestSchema.parse({ operation: "delete_admin", payload: { name } })),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Administrator removal review saved",
  })

  // Same guard as UpdateAdminRoleControl: Google will not let the primary
  // owner be removed here, and a row without a resource `name` has no safe
  // DELETE target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <Button
      size="sm"
      variant="danger-outline"
      aria-label={`Remove ${admin.admin ?? name}`}
      onClick={() => remove.mutate()}
      pending={remove.isPending}
      // The send step needs the listing name to confirm, so a removal can't
      // start while it is unknown.
      disabled={writeBlocked || !locationName || access.busy || Boolean(access.unresolved)}
    >
      Remove
    </Button>
  )
}
