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
      <section aria-labelledby="team-members" className="flex flex-col gap-3">
        <h2 id="team-members" className="text-title font-semibold text-ink">
          Members
        </h2>
        <MembersTable
          actorRole={(session?.role ?? "owner") as MemberRole}
          actorUserId={session?.userId ?? ""}
        />
      </section>
      <section
        aria-labelledby="team-invitations"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="team-invitations"
            className="text-title font-semibold text-ink"
          >
            Invitations
          </h2>
          <p className="text-ui text-ink-muted">
            Invited teammates can see every client until you narrow their
            access.
          </p>
        </div>
        <InvitationsPanel
          actorRole={(session?.role ?? "owner") as MemberRole}
        />
      </section>
    </PageFrame>
  )
}
