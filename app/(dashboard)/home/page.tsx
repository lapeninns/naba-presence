import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { HomeView } from "@/components/home/home-view"
import { homePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Home · NabaPresence" }

export default async function HomePage() {
  const session = await getSession()
  const state = await prefetch(session, homePrefetch())
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Home"
        description="What is waiting for you now, client by client, and how the last 30 days look on Google."
      />
      <HydrationBoundary state={state}>
        <HomeView />
      </HydrationBoundary>
    </PageFrame>
  )
}
