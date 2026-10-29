import { ArchiveIcon } from "lucide-react"
import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { cache } from "react"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { clientIdParamsSchema } from "@/lib/contracts/clients"
import { withTenant } from "@/lib/server/db"
import { clientVisibilityPredicate } from "@/lib/server/permissions"
import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"
import { getSession } from "@/lib/server/session"
import { redirectOutOfClientLayer } from "@/lib/server/workspace-redirect"

type VisibleClient = { id: string; name: string; archived: boolean }

/**
 * The client this session may see, or undefined. Cached per request, so
 * the document title and the layout share one read.
 */
const readVisibleClient = cache(
  async (clientId: string): Promise<VisibleClient | undefined> => {
    const session = await getSession()
    if (!session) return undefined
    if (!clientIdParamsSchema.safeParse({ clientId }).success) return undefined
    const [client] = await withTenant(
      session.organisationId,
      (sql) =>
        sql<VisibleClient[]>`
        select
          c.id::text as id,
          c.name,
          c.archived_at is not null as archived
        from client c
        where c.id = ${clientId}
          and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
      `
    )
    return client
  }
)

/**
 * The client hub's document title names the client, so a tab, the history
 * list and the route announcer say which client this is. Pages beneath
 * (client settings) set their own. A client the session cannot see gets the
 * generic title: the name must not leak through the tab either.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const client = await readVisibleClient(clientId).catch(() => undefined)
  return client ? { title: `${client.name} · NabaPresence` } : {}
}

/**
 * Declares the client scope for the shell, so the topbar's health chip and the
 * reconnect banner report THIS client rather than the whole agency.
 *
 * The visibility check reads inside the transaction but decides outside it:
 * `notFound()` works by throwing a control-flow signal Next catches, and
 * throwing that through `withTenant` puts it inside a rolled-back transaction
 * where it is indistinguishable from a query failure.
 */
export default async function ClientLayout({
  params,
  children,
}: {
  params: Promise<{ clientId: string }>
  children: React.ReactNode
}) {
  const { clientId } = await params
  const session = await getSession()
  // Every page under here redirects a business on its own; the layout does
  // it too, from the requested path, so a nested route added later cannot
  // show a business a client page.
  redirectOutOfClientLayer(
    session,
    (await headers()).get(REQUEST_PATH_HEADER) ?? `/clients/${clientId}`
  )
  // Not an id at all: a not-found, not a database error surfacing as the
  // error page (the uuid column would reject the comparison). After the
  // business redirect, so an old bookmark still lands somewhere useful.
  if (!clientIdParamsSchema.safeParse({ clientId }).success) notFound()

  if (session) {
    const client = await readVisibleClient(clientId)
    // A client the session cannot see reads exactly like one that does not
    // exist, so probing ids tells an outsider nothing.
    if (!client) notFound()
    // An archived client the session can see is not "not found": archiving
    // tells the user to restore it from Clients › Archived, so say where,
    // instead of a 404. Restoring is an owner/admin action, as archiving is.
    // Archiving unfiled its listings (the server refuses to archive a client
    // that still holds any), and a restore does not file them back.
    if (client.archived) {
      const canRestore = session.role === "owner" || session.role === "admin"
      return (
        <PageFrame>
          <PageEmptyState
            icon={<ArchiveIcon />}
            eyebrow="Archived client"
            title={`${client.name} is archived`}
            description={
              canRestore
                ? "It’s hidden from lists and filters. Any listings it had were unfiled, and are still under Listings with their reviews. Restore it from the archived clients to work on it again, then file its listings again from its settings."
                : "It’s hidden from lists and filters. Any listings it had were unfiled, and are still under Listings with their reviews. An owner or admin can restore it."
            }
            action={
              <Link
                href={canRestore ? "/clients?view=archived" : "/clients"}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                {canRestore ? "View archived clients" : "Back to clients"}
              </Link>
            }
          />
        </PageFrame>
      )
    }
  }

  return (
    <ClientScopeProvider clientId={clientId}>{children}</ClientScopeProvider>
  )
}
