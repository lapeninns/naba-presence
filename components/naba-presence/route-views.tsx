"use client"

import { useRouter } from "next/navigation"

import { ConnectionsView } from "@/components/naba-presence/connections-view"
import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import { ReviewsWorkspace } from "@/components/naba-presence/reviews-view"

export function InboxRoute() {
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

export function LocationReviewsRoute({
  locationId,
}: {
  locationId: string
}) {
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
      reviews={reviews.filter((review) => review.locationId === locationId)}
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

export function ConnectionsSettingsRoute() {
  const router = useRouter()
  return <ConnectionsView onNavigate={() => router.push("/settings")} />
}
