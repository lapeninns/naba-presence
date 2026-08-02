import { redirect } from "next/navigation"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { MembersTable } from "@/components/settings/members-table"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"
import type { MemberRole } from "@/lib/settings/forms/invitation"

export const metadata = { title: "Team access · NabaPresence" }

export default async function SettingsTeamPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Team access" description="Who can see and act on this organisation’s reviews and settings." />
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Members</h2>
        <MembersTable actorRole={session.role as MemberRole} actorUserId={session.userId} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Invitations</h2>
        <InvitationsPanel actorRole={session.role as MemberRole} />
      </section>
    </div>
  )
}
