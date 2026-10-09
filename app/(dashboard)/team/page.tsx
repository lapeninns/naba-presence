import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame } from "@/components/app-shell/page-frame"
import { TeamView } from "@/components/settings/team-view"
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
      <TeamView
        actorRole={(session?.role ?? "owner") as MemberRole}
        actorUserId={session?.userId ?? ""}
      />
    </PageFrame>
  )
}
