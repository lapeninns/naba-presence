"use client"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { useSessionRole } from "@/lib/queries/use-session"
import type { MemberRole } from "@/lib/settings/forms/invitation"

/**
 * Invite the people who will work on this client.
 *
 * Optional: a one-person agency never needs it, and blocking setup on an
 * invitation nobody is going to send is friction for its own sake.
 */
function StepTeam({ clientName }: { clientName: string }) {
  const role = useSessionRole()
  return (
    <>
      <p className="text-ui text-ink-muted">
        Optional. Invited teammates can see every client by default. You can
        narrow that to {clientName} alone from Team once they accept.
      </p>
      <InvitationsPanel actorRole={(role ?? "owner") as MemberRole} />
    </>
  )
}

export { StepTeam }
