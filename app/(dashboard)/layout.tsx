import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell/app-shell"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"
import { makeQueryClient } from "@/lib/queries/query-client"
import { listConnections } from "@/lib/server/connections"
import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) redirect("/sign-in")

  const queryClient = makeQueryClient()
  if (session) {
    queryClient.setQueryData(queryKeys.connections, {
      connections: await listConnections(session),
    })
  }

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AppShell session={session}>{children}</AppShell>
      </HydrationBoundary>
    </QueryProvider>
  )
}
