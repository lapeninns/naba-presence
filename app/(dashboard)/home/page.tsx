import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { OverviewView } from "@/components/home/overview-view"
import { homePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

// The route stays /home; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Overview · NabaPresence" }

export default async function HomePage() {
  const session = await getSession()
  const state = await prefetch(session, homePrefetch())
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Overview"
        description="Open work waiting for you now, and how the last 30 days look on Google."
      />
      <HydrationBoundary state={state}>
        <OverviewView />
      </HydrationBoundary>
    </PageFrame>
  )
}
