import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell/app-shell"
import { sessionSchema } from "@/lib/api/session"
import {
  projectDefault,
  projectManagement,
  toDirectoryEntriesFromDefault,
  toDirectoryEntriesFromManagement,
} from "@/lib/locations/directory"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"
import { makeQueryClient } from "@/lib/queries/query-client"
import { listConnections } from "@/lib/server/connections"
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
  if (!session && !allowAnonymous) redirect("/sign-in")

  const queryClient = makeQueryClient()
  // Derived from the same rows we hydrate below rather than a second query —
  // it only decides whether the nav shows a Locations item.
  let locationCount = 0
  if (session) {
    queryClient.setQueryData(queryKeys.connections, {
      connections: await listConnections(session),
    })

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

    const rows = await listLocationDirectoryRows(session)
    locationCount = rows.length
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
        <AppShell session={session} multiLocation={locationCount > 1}>
          {children}
        </AppShell>
      </HydrationBoundary>
    </QueryProvider>
  )
}
