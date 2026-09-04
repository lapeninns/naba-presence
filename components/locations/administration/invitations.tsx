"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runAdministrationOperation } from "@/lib/api/location-administration"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import { createAdminSchema } from "@/lib/locations/forms/administration"
import {
  asArray,
  asRecord,
  asString,
  type RawRecord,
} from "@/lib/locations/google-values"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { EDITABLE_ROLES } from "./admins"
import { useAdministrationSection } from "./context"

// --- Pending invitations ---------------------------------------------------
export function InvitationsList({ data }: { data: unknown }) {
  const invitations = asArray(asRecord(data).invitations)
  if (invitations.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        No pending invitations.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {invitations.map((invitation, index) => (
        <InvitationRow
          key={asString(invitation.name) || index}
          invitation={invitation}
        />
      ))}
    </ul>
  )
}

type InvitationResponse = "accept_invitation" | "decline_invitation"

function InvitationRow({ invitation }: { invitation: RawRecord }) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const name = asString(invitation.name)
  const role = asString(invitation.role)

  const respond = useResourceMutation({
    mutationFn: (operation: InvitationResponse) =>
      runAdministrationOperation(locationId, { operation, payload: { name } }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: (_data, operation) =>
      operation === "accept_invitation"
        ? "Invitation accepted"
        : "Invitation declined",
  })
  // Both buttons share one mutation, keyed by `operation` — so only the
  // clicked button's label/pending state should change, not both. `variables`
  // holds whichever operation is in flight.
  const pendingOperation = respond.isPending ? respond.variables : null

  return (
    <li className="flex items-center justify-between gap-2 rounded-(--np-radius-card) border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium">
          {role ? adminRoleLabel(role) : "Invitation"}
        </span>
        <Badge variant="info">Invited</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond.mutate("decline_invitation")}
          disabled={writeBlocked || !name || respond.isPending}
        >
          {pendingOperation === "decline_invitation" ? "Declining…" : "Decline"}
        </Button>
        <Button
          size="sm"
          onClick={() => respond.mutate("accept_invitation")}
          disabled={writeBlocked || !name || respond.isPending}
        >
          {pendingOperation === "accept_invitation" ? "Accepting…" : "Accept"}
        </Button>
      </div>
    </li>
  )
}

// --- Create admin ------------------------------------------------------
// These are our own UI-level scope values (not a Google enum), but the
// trigger still must not go blank/raw on first paint (spec §7) - factor the
// label here so the SelectValue render-function and the SelectItems below
// can never drift out of sync.
const ADMIN_SCOPE_LABELS: Record<string, string> = {
  location: "This location",
  account: "The whole Google account",
}

export function CreateAdminDialog() {
  const { locationId, disabled, publishReason } = useAdministrationSection()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState("location")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("MANAGER")

  const parsed = createAdminSchema.safeParse({ scope, admin: email, role })
  const emailError =
    email.trim().length > 0 && !parsed.success
      ? parsed.error.issues.find((issue) => issue.path[0] === "admin")?.message
      : undefined

  const create = useResourceMutation({
    mutationFn: () => {
      const values = createAdminSchema.parse({ scope, admin: email, role })
      return runAdministrationOperation(locationId, {
        operation: "create_admin",
        payload: values,
      })
    },
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Invitation sent",
    onSuccess: () => {
      setOpen(false)
      setEmail("")
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEmail("")
      }}
    >
      <DialogTrigger render={<Button disabled={disabled} />}>
        Add administrator
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>
            Invite someone to help manage this business on Google.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-ui font-medium">Scope</span>
            <Select
              value={scope}
              onValueChange={(value: string | null) => value && setScope(value)}
            >
              <SelectTrigger aria-label="Scope">
                <SelectValue>
                  {(value: string | null) =>
                    value ? (ADMIN_SCOPE_LABELS[value] ?? value) : ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="location">
                  {ADMIN_SCOPE_LABELS.location}
                </SelectItem>
                <SelectItem value="account">
                  {ADMIN_SCOPE_LABELS.account}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field error={emailError}>
            <FieldLabel>Email address</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FieldError />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-ui font-medium">Role</span>
            <Select
              value={role}
              onValueChange={(value: string | null) => value && setRole(value)}
            >
              <SelectTrigger aria-label="Role">
                <SelectValue>
                  {(value: string | null) =>
                    value ? adminRoleLabel(value) : ""
                  }
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
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={() => create.mutate()}
            disabled={
              !parsed.success || Boolean(publishReason) || create.isPending
            }
          >
            {create.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
