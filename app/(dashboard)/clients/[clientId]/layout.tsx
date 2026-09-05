import { notFound } from "next/navigation"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
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
  const session = await getSession()

  if (session) {
    const [client] = await withTenant(
      session.organisationId,
      (sql) =>
        sql<{ id: string }[]>`
        select c.id::text as id
        from client c
        where c.id = ${clientId}
          and c.archived_at is null
          and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
      `
    )
    // A client the session cannot see reads exactly like one that does not
    // exist, so probing ids tells an outsider nothing.
    if (!client) notFound()
  }

  return (
    <ClientScopeProvider clientId={clientId}>{children}</ClientScopeProvider>
  )
}
