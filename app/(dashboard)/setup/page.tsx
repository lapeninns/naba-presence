import { ChevronRightIcon, CircleCheckIcon, PlusIcon } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type * as React from "react"

import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { SetupWizard } from "@/components/setup/setup-wizard"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { clientIdParamsSchema } from "@/lib/contracts/clients"
import { withTenant } from "@/lib/server/db"
import { clientVisibilityPredicate } from "@/lib/server/permissions"
import { businessHomeClientId } from "@/lib/server/clients"
import { getSession } from "@/lib/server/session"
import { cn } from "@/lib/utils"
import { cardClassName } from "@/components/ui/card"

export const metadata = { title: "Setup · NabaPresence" }

/**
 * The chooser's client rows are Notion Mail list rows: the whole row is the
 * link (it keeps the old button's name, "Resume setup for X"), the client's
 * own mark leads, and the action's word sits on the right. Inside a card the
 * row takes the card's gutter, and the card's own hairlines divide the rows
 * edge to edge as before.
 */
const ROW_CLASS = "px-(--np-card-pad)"
const ROW_WRAPPER_CLASS = "after:hidden"
/** A client's name is its identity: it wraps, never cut off. */
const NAME_CLASS = "whitespace-normal break-words"

function RowAction({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-ui font-medium text-accent-ink">
      {children}
      <ChevronRightIcon aria-hidden className="size-4" />
    </span>
  )
}

/**
 * The setup flow always runs FOR a client, named in the query string.
 *
 * Arriving without one offers a choice rather than redirecting. A redirect
 * thrown here would be a SOFT one — this page sits inside the dashboard
 * layout, which awaits the database, so the shell is already streaming and the
 * browser ends up showing the destination's content at this address. Choosing
 * is also the better answer: an operator who lands here deliberately gets to
 * pick, instead of being teleported somewhere they did not ask for.
 *
 * A `?client=` that is not an id, or names a client this session cannot see
 * (or one that is archived), is a not-found, exactly like the client's own
 * pages: never a wizard for some other client, never a probe that tells an
 * outsider the id exists.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: requestedClient } = await searchParams
  const session = await getSession()
  const business = session?.workspaceMode === "business"
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area={business ? "Setup" : "Client setup"} />
  }

  // A business has no client to pick: setup runs for the business itself,
  // which is its one home client. Resolved here, not redirected, for the
  // soft-redirect reason above.
  let client = requestedClient
  if (session && business && !client) {
    client =
      (await withTenant(session.organisationId, (sql) =>
        businessHomeClientId(sql, session.organisationId)
      )) ?? undefined
    if (!client) {
      return (
        <PageFrame>
          <PageHeader
            title="Setup"
            description="Your business isn’t ready for setup yet. Try again in a moment."
          />
        </PageFrame>
      )
    }
  }

  if (client) {
    if (!clientIdParamsSchema.safeParse({ clientId: client }).success) {
      notFound()
    }
    if (session) {
      const [visible] = await withTenant(
        session.organisationId,
        (sql) =>
          sql<{ id: string }[]>`
          select c.id::text as id
          from client c
          where c.id = ${client}
            and c.archived_at is null
            and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
        `
      )
      // Decided outside the transaction: `notFound()` throws a control-flow
      // signal that a rolled-back transaction would swallow as a failure.
      if (!visible) notFound()
    }
    return (
      <ClientScopeProvider clientId={client}>
        <PageFrame>
          <SetupWizard clientId={client} />
        </PageFrame>
      </ClientScopeProvider>
    )
  }

  type ClientRow = {
    id: string
    name: string
    colour: string | null
    linked: number
  }
  // Every live client, with how many listings it has linked. "Add listings
  // from Google" on /listings lands here without a client, so the existing
  // clients have to be reachable too: listing only the unfinished ones left
  // an agency whose clients were all set up with no way to add one more
  // listing from that button.
  const clients: ClientRow[] = session
    ? await withTenant(
        session.organisationId,
        (sql) =>
          sql<ClientRow[]>`
          select
            c.id::text as id,
            c.name,
            c.colour,
            (
              select count(*)::int
              from location l
              join location_link ll on ll.location_id = l.id and ll.is_active
              where l.client_id = c.id
            ) as linked
          from client c
          where c.archived_at is null
            and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
          order by c.created_at desc
          limit 200
        `
      )
    : []
  // "Unfinished" means no linked location: whatever else has been filled in,
  // a client with none is not yet doing anything.
  const unfinished = clients.filter((entry) => entry.linked === 0).slice(0, 5)
  const established = clients
    .filter((entry) => entry.linked > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageFrame>
      <PageHeader
        title="Client setup"
        eyebrow="Clients"
        description="Setup runs for one client at a time. Pick the one you’re working on, or add more listings to a client you already look after."
      />
      <section
        aria-labelledby="setup-waiting"
        className={cardClassName({ className: "overflow-hidden" })}
      >
        <div className="flex flex-col gap-0.5 border-b border-line-subtle px-(--np-card-pad) py-4">
          <h2 id="setup-waiting" className="text-title font-semibold text-ink">
            Waiting to be set up
          </h2>
          <p className="text-ui text-ink-muted">
            Clients with no listing linked to Google yet, newest first.
          </p>
        </div>
        {unfinished.length === 0 ? (
          <Empty
            tone="ok"
            titleAs="h3"
            icon={<CircleCheckIcon />}
            title="Nothing waiting to be set up"
            description="Every client you look after has at least one listing linked to Google."
          />
        ) : (
          <ListRows className="divide-y divide-line-subtle">
            {unfinished.map((entry) => (
              <ListRow
                key={entry.id}
                href={`/setup?client=${entry.id}`}
                aria-label={`Resume setup for ${entry.name}`}
                emphasis="neutral"
                className={ROW_CLASS}
                wrapperClassName={ROW_WRAPPER_CLASS}
                leading={
                  <ClientAvatar name={entry.name} colour={entry.colour} />
                }
                title={<span className={NAME_CLASS}>{entry.name}</span>}
                meta={<RowAction>Resume setup</RowAction>}
                subtitle="No listings linked yet"
              />
            ))}
          </ListRows>
        )}
      </section>
      {established.length > 0 ? (
        <section
          aria-labelledby="setup-add-listings"
          className={cardClassName({ className: "overflow-hidden" })}
        >
          <div className="flex flex-col gap-0.5 border-b border-line-subtle px-(--np-card-pad) py-4">
            <h2
              id="setup-add-listings"
              className="text-title font-semibold text-ink"
            >
              Add listings to a client
            </h2>
            <p className="text-ui text-ink-muted">
              Link more of a client’s Google Business Profile locations.
            </p>
          </div>
          <ListRows className="divide-y divide-line-subtle">
            {established.map((entry) => (
              <ListRow
                key={entry.id}
                href={`/setup?client=${entry.id}&step=locations`}
                aria-label={`Add listings to ${entry.name}`}
                emphasis="neutral"
                className={ROW_CLASS}
                wrapperClassName={ROW_WRAPPER_CLASS}
                leading={
                  <ClientAvatar name={entry.name} colour={entry.colour} />
                }
                title={<span className={NAME_CLASS}>{entry.name}</span>}
                meta={<RowAction>Add listings</RowAction>}
                subtitle={
                  entry.linked === 1
                    ? "1 listing linked"
                    : `${entry.linked} listings linked`
                }
              />
            ))}
          </ListRows>
        </section>
      ) : null}
      <section
        aria-labelledby="setup-start-new"
        className={cardClassName({
          pad: true,
          className: "flex flex-wrap items-center justify-between gap-4",
        })}
      >
        <div className="flex min-w-0 grow basis-72 flex-col gap-1">
          <h2
            id="setup-start-new"
            className="text-title font-semibold text-ink"
          >
            Start a new client
          </h2>
          <p className="text-ui text-ink-muted">
            Name the business first. Setup then connects its Google account and
            links its listings.
          </p>
        </div>
        <Link href="/clients/new" className={cn(buttonVariants())}>
          <PlusIcon aria-hidden />
          New client
        </Link>
      </section>
    </PageFrame>
  )
}
