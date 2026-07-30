"use client"

import { useRouter } from "next/navigation"

import { ConnectionsView } from "@/components/naba-presence/connections-view"
import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import { ReviewQueue } from "@/components/naba-presence/reviews/review-queue"

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
    <ReviewQueue
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
      heading={{
        title: "Inbox",
        description:
          "Google reviews awaiting a reply, approval, or publication across every linked location.",
      }}
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
    <ReviewQueue
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
      locationId={locationId}
      heading={{
        title: "Reviews",
        description: "Every Google review for this location.",
      }}
    />
  )
}

export function ConnectionsSettingsRoute() {
  const router = useRouter()
  return <ConnectionsView onNavigate={() => router.push("/settings")} />
}
