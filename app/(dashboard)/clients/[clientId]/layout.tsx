import { ArchiveIcon } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { clientIdParamsSchema } from "@/lib/contracts/clients"
import { withTenant } from "@/lib/server/db"
import { clientVisibilityPredicate } from "@/lib/server/permissions"
import { getSession } from "@/lib/server/session"

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
  // Not an id at all: a not-found, not a database error surfacing as the
  // error page (the uuid column would reject the comparison).
  if (!clientIdParamsSchema.safeParse({ clientId }).success) notFound()
  const session = await getSession()

  if (session) {
    const [client] = await withTenant(
      session.organisationId,
      (sql) =>
        sql<{ id: string; name: string; archived: boolean }[]>`
        select
          c.id::text as id,
          c.name,
          c.archived_at is not null as archived
        from client c
        where c.id = ${clientId}
          and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
      `
    )
    // A client the session cannot see reads exactly like one that does not
    // exist, so probing ids tells an outsider nothing.
    if (!client) notFound()
    // An archived client the session can see is not "not found": the archive
    // dialog promises it can be restored, so say where, instead of a 404.
    // Restoring is an owner/admin action, as archiving is.
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
                ? "Its listings, reviews and reports are kept but hidden. Restore it from the archived clients to work on it again."
                : "Its listings, reviews and reports are kept but hidden. An owner or admin can restore it."
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
