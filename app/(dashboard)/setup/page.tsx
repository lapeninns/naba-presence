import { Building2, Sparkles } from "lucide-react"
import Link from "next/link"

import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { SetupWizard } from "@/components/setup/setup-wizard"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { withTenant } from "@/lib/server/db"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Client setup · NabaPresence" }

/**
 * The setup flow always runs FOR a client, named in the query string.
 *
 * Arriving without one offers a choice rather than redirecting. A redirect
 * thrown here would be a SOFT one — this page sits inside the dashboard
 * layout, which awaits the database, so the shell is already streaming and the
 * browser ends up showing the destination's content at this address. Choosing
 * is also the better answer: an operator who lands here deliberately gets to
 * pick, instead of being teleported somewhere they did not ask for.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client } = await searchParams
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area="Client setup" />
  }

  if (client) {
    return (
      <ClientScopeProvider clientId={client}>
        <PageFrame>
          <SetupWizard clientId={client} />
        </PageFrame>
      </ClientScopeProvider>
    )
  }

  const unfinished = session
    ? await withTenant(
        session.organisationId,
        (sql) =>
          sql<{ id: string; name: string }[]>`
          select c.id::text as id, c.name
          from client c
          where c.archived_at is null
            -- "Unfinished" means no linked location: whatever else has been
            -- filled in, a client with none is not yet doing anything.
            and not exists (
              select 1
              from location l
              join location_link ll on ll.location_id = l.id and ll.is_active
              where l.client_id = c.id
            )
          order by c.created_at desc
          limit 5
        `
      )
    : []

  return (
    <PageFrame>
      <PageHeader
        title="Client setup"
        eyebrow="Clients"
        description="Setup runs for one client at a time. Pick the one you're working on."
        actions={
          <Link href="/clients/new" className={buttonVariants({ pill: true })}>
            New client
          </Link>
        }
      />
      {unfinished.length === 0 ? (
        <Empty
          icon={<Sparkles />}
          title="Nothing waiting to be set up"
          description="Every client you look after has at least one location linked to Google."
        />
      ) : (
        <GroupedList
          header="Waiting to be set up"
          footer="A client stays here until at least one of its locations is linked to Google."
        >
          {unfinished.map((entry) => (
            <GroupedListItem
              key={entry.id}
              icon={<Building2 />}
              label={entry.name}
              trailing="No locations linked yet"
              href={`/setup?client=${entry.id}`}
            />
          ))}
        </GroupedList>
      )}
    </PageFrame>
  )
}
