"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { ConnectionsView } from "@/components/naba-presence/connections-view"
import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import { ReviewQueue } from "@/components/naba-presence/reviews/review-queue"
import type { Review } from "@/lib/naba-presence-data"

export function InboxRoute() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState("")
  const {
    apiStatus,
    counts,
    queueScopeToken,
    refreshCounts,
    revalidateQueueConnection,
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
      queueScopeToken={queueScopeToken}
      refreshCounts={refreshCounts}
      revalidateConnection={revalidateQueueConnection}
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

export function LocationReviewsRoute({ locationId }: { locationId: string }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState("")
  const {
    apiStatus,
    counts,
    queueScopeToken,
    refreshCounts,
    revalidateQueueConnection,
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
      queueScopeToken={queueScopeToken}
      refreshCounts={refreshCounts}
      revalidateConnection={revalidateQueueConnection}
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
