"use client"

import { useRouter } from "next/navigation"

import { AnalyticsView } from "@/components/naba-presence/analytics-view"
import { ConnectionsView } from "@/components/naba-presence/connections-view"
import { OverviewView } from "@/components/naba-presence/overview-view"
import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import { ReviewsWorkspace } from "@/components/naba-presence/reviews-view"
import { SettingsView } from "@/components/naba-presence/settings-view"

export function OverviewRoute() {
  const router = useRouter()
  const { reviews, session } = useNabaPresenceDashboard()

  return (
    <OverviewView
      reviews={reviews}
      onNavigate={(view) => router.push(`/${view}`)}
      displayName={session?.displayName ?? "Account"}
      organisationName={session?.organisationName ?? "Your organisation"}
    />
  )
}

export function ReviewsRoute() {
  const {
    reviews,
    setReviews,
    selectedId,
    setSelectedId,
    apiStatus,
    counts,
    refreshCounts,
    connectionState,
    lastRefreshedAt,
    refreshReviews,
  } = useNabaPresenceDashboard()

  return (
    <ReviewsWorkspace
      reviews={reviews}
      setReviews={setReviews}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      apiStatus={apiStatus}
      counts={counts}
      refreshCounts={refreshCounts}
      connectionState={connectionState}
      lastRefreshedAt={lastRefreshedAt}
      onRefresh={refreshReviews}
    />
  )
}

export function AnalyticsRoute() {
  return <AnalyticsView />
}

export function ConnectionsRoute() {
  const router = useRouter()
  return <ConnectionsView onNavigate={() => router.push("/settings")} />
}

export function SettingsRoute() {
  return <SettingsView />
}
