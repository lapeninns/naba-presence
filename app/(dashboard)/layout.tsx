import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell/app-shell"
import { REQUEST_PATH_HEADER, signInPathFor } from "@/lib/api/next-path"
import { sessionSchema } from "@/lib/api/session"
import {
  CLIENT_SCOPE_COOKIE,
  parseClientScopeCookie,
} from "@/lib/clients/scope"
import {
  projectDefault,
  projectManagement,
  toDirectoryEntriesFromDefault,
  toDirectoryEntriesFromManagement,
} from "@/lib/locations/directory"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"
import { makeQueryClient } from "@/lib/queries/query-client"
import { listClientSummaries } from "@/lib/server/clients"
import { listConnections } from "@/lib/server/connections"
import { withTenant } from "@/lib/server/db"
import { listLocationDirectoryRows } from "@/lib/server/location-directory"
import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) {
    // proxy.ts forwards the requested path; keep it as ?next= so a deep
    // link followed while signed out lands where it pointed after sign-in.
    const requested = (await headers()).get(REQUEST_PATH_HEADER)
    redirect(signInPathFor(requested))
  }

  const queryClient = makeQueryClient()
  // The client the operator last worked (lib/clients/scope.ts). Read here so
  // the sidebar's Inbox, Listings and Reports links carry it in the server
  // HTML; kept only when it names a client this session can still see.
  let rememberedClientId = parseClientScopeCookie(
    (await cookies()).get(CLIENT_SCOPE_COOKIE)?.value
  )
  if (session) {
    // Each of these opens its own short read transaction and none reads the
    // others' output, so awaiting them one after another only stacked three
    // round trips onto every full load of every dashboard page. Issued
    // together they cost the slowest one instead of the sum, and three
    // concurrent checkouts sit well inside DATABASE_POOL_MAX (10 by default).
    const [connections, clients, rows] = await Promise.all([
      listConnections(session),
      withTenant(session.organisationId, (sql) =>
        listClientSummaries(sql, session)
      ),
      listLocationDirectoryRows(session),
    ])

    queryClient.setQueryData(queryKeys.connections, { connections })

    // Hydrating the session is what makes the directory hydration below
    // actually land: useLocationDirectory picks its query key from the role,
    // so without this the first client render sees role `null`, reads the
    // default key, misses the management data we just hydrated, and fires a
    // wasted request before flipping. Parsing through the same sessionSchema
    // the HTTP route's client uses keeps both paths byte-identical and drops
    // `sessionId`, which has no business in the RSC flight payload.
    queryClient.setQueryData(queryKeys.session, {
      session: sessionSchema.parse(session),
    })

    // The sidebar pins recent clients and the topbar chip reports their
    // health, so the client list is shell furniture: hydrating it here is
    // what keeps the first paint from showing an empty nav that fills in.
    queryClient.setQueryData(queryKeys.clients, clients)
    if (
      clients.items.length <= 1 ||
      !clients.items.some((client) => client.id === rememberedClientId)
    ) {
      rememberedClientId = null
    }

    const management = session.role === "owner" || session.role === "admin"
    queryClient.setQueryData(
      management ? queryKeys.locationsManagement : queryKeys.locations,
      management
        ? toDirectoryEntriesFromManagement(projectManagement(rows))
        : toDirectoryEntriesFromDefault(projectDefault(rows, session.role))
    )
  }

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AppShell session={session} rememberedClientId={rememberedClientId}>
          {children}
        </AppShell>
      </HydrationBoundary>
    </QueryProvider>
  )
}
