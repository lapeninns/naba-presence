"use client"

import { UserPlusIcon } from "lucide-react"
import { useState } from "react"

import { StatusPill } from "@/components/ui/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input, inputHints } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
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
import { invitationPlace } from "./access-target"
import { useAdministrationSection } from "./context"
import { StaleRosterPlaceholder, useAdministrationAccess } from "./access-workspace"

// --- Pending invitations ---------------------------------------------------
export function InvitationsList({ data }: { data: unknown }) {
  const invitations = asArray(asRecord(data).invitations)
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  if (rosterUpdating || rosterUnavailable)
    return <StaleRosterPlaceholder what="pending invitations" />
  if (invitations.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-ui text-ink-muted">
          No pending invitations.
          <span>
            {" "}
            Invitations for this Google account appear here until they’re
            accepted or declined.
          </span>
        </CardContent>
      </Card>
    )
  }
  return (
    <GroupedList aria-label="Pending invitations">
      {invitations.map((invitation, index) => (
        <InvitationRow
          key={asString(invitation.name) || index}
          invitation={invitation}
        />
      ))}
    </GroupedList>
  )
}

type InvitationResponse = "accept_invitation" | "decline_invitation"

function InvitationRow({ invitation }: { invitation: RawRecord }) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const access = useAdministrationAccess()
  const name = asString(invitation.name)
  const role = asString(invitation.role)
  // What accepting would grant: the role, and the location or account it is for.
  const place = invitationPlace(invitation)

  const respond = useResourceMutation({
    mutationFn: (operation: InvitationResponse) =>
      access.preview(administrationAccessRequestSchema.parse({ operation, payload: { name } })),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: (_data, operation) =>
      operation === "accept_invitation"
        ? "Invitation acceptance review saved"
        : "Invitation decline review saved",
  })
  // Both buttons share one mutation, keyed by `operation` — so only the
  // clicked button's label/pending state should change, not both. `variables`
  // holds whichever operation is in flight.
  const pendingOperation = respond.isPending ? respond.variables : null

  return (
    <GroupedListItem
      // Leading: what the row is (an invitation), neutral ink, not a status hue.
      icon={<UserPlusIcon />}
      label={role ? `${adminRoleLabel(role)} invitation` : "Invitation"}
      description={`${place ? `To manage ${place}` : "For the connected Google account"} · waiting for a reply on Google`}
      trailing={
        <>
          <StatusPill tone="pending">Invited</StatusPill>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond.mutate("decline_invitation")}
            disabled={writeBlocked || !name || respond.isPending || access.busy || Boolean(access.unresolved)}
          >
            {pendingOperation === "decline_invitation"
              ? "Reviewing…"
              : "Review decline"}
          </Button>
          <Button
            size="sm"
            onClick={() => respond.mutate("accept_invitation")}
            disabled={writeBlocked || !name || respond.isPending || access.busy || Boolean(access.unresolved)}
          >
            {pendingOperation === "accept_invitation" ? "Reviewing…" : "Review acceptance"}
          </Button>
        </>
      }
    />
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
  const { locationId, publishReason, writeBlocked } = useAdministrationSection()
  const access = useAdministrationAccess()
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
      return access.preview(administrationAccessRequestSchema.parse({
        operation: "create_admin",
        payload: values,
      }))
    },
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Administrator invitation review saved",
    onSuccess: () => {
      setOpen(false)
      setEmail("")
    },
  })

  const cannotSubmit =
    !parsed.success || Boolean(publishReason) || create.isPending || access.busy || Boolean(access.unresolved)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEmail("")
      }}
      // A typed address is a draft: a stray scrim tap or Escape asks first.
      dirty={email.trim().length > 0}
      onDiscard={() => setEmail("")}
    >
      <DialogTrigger render={<Button disabled={writeBlocked || access.busy || Boolean(access.unresolved)} />}>
        <UserPlusIcon aria-hidden data-icon="inline-start" />
        Add administrator
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>
            Google emails them an invitation. They get access once they
            accept it on Google. Reviewing sends nothing yet.
          </DialogDescription>
        </DialogHeader>
        {/* A real form: Enter in the email field reviews the invitation. */}
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!cannotSubmit) create.mutate()
          }}
        >
          <Field error={emailError}>
            <FieldLabel>Email address</FieldLabel>
            <Input
              {...inputHints.email}
              // Someone else's address: don't offer the operator's own.
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FieldError />
          </Field>
          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value: string | null) => value && setRole(value)}
            >
              <SelectTrigger className="w-full">
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
          </Field>
          <Field>
            <FieldLabel>Scope</FieldLabel>
            <Select
              value={scope}
              onValueChange={(value: string | null) => value && setScope(value)}
            >
              <SelectTrigger className="w-full">
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
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={cannotSubmit}>
              {create.isPending ? "Reviewing…" : "Review invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
