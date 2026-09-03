import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { MembersTable } from "@/components/settings/members-table"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"
import type { MemberRole } from "@/lib/settings/forms/invitation"

export const metadata = { title: "Team · NabaPresence" }

/**
 * Promoted out of Settings: for an agency, who can act on which client is
 * day-to-day work, not a configuration screen visited twice a year.
 */
export default async function TeamPage() {
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area="Team access" />
  }

  return (
    <PageFrame>
      <PageHeader
        title="Team"
        description="Who can see and act on your clients' reviews and settings."
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Members</h2>
        <MembersTable
          actorRole={(session?.role ?? "owner") as MemberRole}
          actorUserId={session?.userId ?? ""}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Invitations</h2>
        <InvitationsPanel actorRole={(session?.role ?? "owner") as MemberRole} />
      </section>
    </PageFrame>
  )
}
