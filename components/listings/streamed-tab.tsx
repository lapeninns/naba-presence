import "server-only"

import { HydrationBoundary } from "@tanstack/react-query"
import { Suspense, type ReactNode } from "react"

import { TabLoading } from "@/components/locations/tab-states"
import { tabPendingLabel } from "@/lib/locations/gating"
import { prefetch, type PrefetchEntry } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

type Entries = (session: Session) => PrefetchEntry[]

/**
 * A listing editor whose first read reaches Google, streamed.
 *
 * The page around it (header, area tabs) renders at once; this boundary
 * shows the tab's own pending state (the same `TabLoading` line LocationTab
 * draws while its resource query is pending, so swapping one for the other
 * moves nothing) until the server read lands, then streams the editor with
 * the read in its own `<HydrationBoundary>`. The editor's hooks find the
 * data on their first render, on the server and in the hydrating browser
 * alike, so the editor is in the HTML instead of waiting for the client
 * bundle and a client fetch.
 *
 * A failed read is left out by `prefetch` (logged, never thrown): the editor
 * then renders pending, fetches in the browser and shows its error and
 * retry as it always has. Never a page error.
 */
export function StreamedTab({
  session,
  entries,
  loadingLabel,
  children,
}: {
  session: Session | null
  entries: Entries
  /** LocationTab's `loadingLabel` for the same tab, e.g. "opening hours". */
  loadingLabel: string
  children: ReactNode
}) {
  return (
    <Suspense fallback={<TabLoading label={tabPendingLabel(loadingLabel)} />}>
      <Prefetched session={session} entries={entries}>
        {children}
      </Prefetched>
    </Suspense>
  )
}

async function Prefetched({
  session,
  entries,
  children,
}: {
  session: Session | null
  entries: Entries
  children: ReactNode
}) {
  const state = await prefetch(session, entries)
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>
}
