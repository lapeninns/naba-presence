"use client"

import { UserPlusIcon } from "lucide-react"

import { StatusPill } from "@/components/ui/status-pill"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Empty } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { adminRoleLabel } from "@/lib/locations/console-labels"
import {
  asArray,
  asRecord,
  asString,
  type RawRecord,
} from "@/lib/locations/google-values"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { invitationPlace } from "./access-target"
import { useAdministrationSection } from "./context"
import {
  StaleRosterPlaceholder,
  useAdministrationAccess,
} from "./access-workspace"

// --- Pending invitations ---------------------------------------------------
export function InvitationsList({ data }: { data: unknown }) {
  const invitations = asArray(asRecord(data).invitations)
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  if (rosterUpdating || rosterUnavailable)
    return <StaleRosterPlaceholder what="pending invitations" />
  if (invitations.length === 0) {
    return (
      <Empty
        size="sm"
        framed
        title="No pending invitations."
        description="Invitations for this Google account appear here until they’re accepted or declined."
      />
    )
  }
  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      <ListRows aria-label="Pending invitations">
        {invitations.map((invitation, index) => (
          <InvitationRow
            key={asString(invitation.name) || index}
            invitation={invitation}
          />
        ))}
      </ListRows>
    </div>
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
      access.preview(
        administrationAccessRequestSchema.parse({
          operation,
          payload: { name },
        })
      ),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: (_data, operation) =>
      operation === "accept_invitation"
        ? "Acceptance ready to approve"
        : "Decline ready to approve",
  })
  // Both buttons share one mutation, keyed by `operation` — so only the
  // clicked button's label/pending state should change, not both. `variables`
  // holds whichever operation is in flight.
  const pendingOperation = respond.isPending ? respond.variables : null

  return (
    // A row with its own buttons, so the row itself is not a target.
    <ListRow
      interactive={false}
      emphasis="neutral"
      // Leading: what the row is (an invitation), a neutral avatar, never a
      // status hue (D9).
      leading={
        <Avatar size="list" aria-hidden>
          <AvatarFallback>
            <UserPlusIcon className="size-4" strokeWidth={1.75} />
          </AvatarFallback>
        </Avatar>
      }
      title={role ? `${adminRoleLabel(role)} invitation` : "Invitation"}
      trailing={<StatusPill tone="pending">Invited</StatusPill>}
      subtitle={
        <span className="block whitespace-normal">
          {`${place ? `To manage ${place}` : "For the connected Google account"} · waiting for a reply on Google`}
        </span>
      }
      tags={
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond.mutate("decline_invitation")}
            disabled={
              writeBlocked ||
              !name ||
              respond.isPending ||
              access.busy ||
              Boolean(access.unresolved)
            }
          >
            {pendingOperation === "decline_invitation"
              ? "Reviewing…"
              : "Review decline"}
          </Button>
          <Button
            size="sm"
            onClick={() => respond.mutate("accept_invitation")}
            disabled={
              writeBlocked ||
              !name ||
              respond.isPending ||
              access.busy ||
              Boolean(access.unresolved)
            }
          >
            {pendingOperation === "accept_invitation"
              ? "Reviewing…"
              : "Review acceptance"}
          </Button>
        </>
      }
    />
  )
}

// --- Create admin ------------------------------------------------------
/** The "Invite someone" button; the invitation itself is the sheet the access workspace holds. */
export function CreateAdminDialog() {
  const { writeBlocked } = useAdministrationSection()
  const access = useAdministrationAccess()
  return (
    <Button
      disabled={writeBlocked || access.busy || Boolean(access.unresolved)}
      onClick={access.openInvite}
    >
      <UserPlusIcon aria-hidden data-icon="inline-start" />
      Invite someone
    </Button>
  )
}
