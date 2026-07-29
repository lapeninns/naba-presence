"use client"

import { useEffect, useState } from "react"

import { AnalyticsView } from "@/components/naba-review/analytics-view"
import { AppShell } from "@/components/naba-review/app-shell"
import { ConnectionsView } from "@/components/naba-review/connections-view"
import { OverviewView } from "@/components/naba-review/overview-view"
import { MenuAssistantView } from "@/components/naba-review/menu-assistant-view"
import { ReviewsWorkspace } from "@/components/naba-review/reviews-view"
import { SettingsView } from "@/components/naba-review/settings-view"
import { type View } from "@/components/naba-review/shared"
import { Review } from "@/lib/naba-review-data"
import {
  type AppSession,
  loadReviews,
  loadSession,
} from "@/lib/naba-review-api"

export function NabaReviewApp() {
  const [activeView, setActiveView] = useState<View>("reviews")
  const [reviews, setReviews] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [apiStatus, setApiStatus] = useState<"loading" | "connected" | "error">(
    "loading"
  )
  const [session, setSession] = useState<AppSession | null>(null)

  async function refreshReviews() {
    try {
      const loaded = await loadReviews()
      setReviews(loaded)
      setSelectedId((current) =>
        loaded.some((review) => review.id === current)
          ? current
          : (loaded[0]?.id ?? "")
      )
      setApiStatus("connected")
    } catch {
      setApiStatus("error")
    }
  }

  useEffect(() => {
    let active = true
    void Promise.allSettled([loadReviews(), loadSession()]).then(
      ([reviewsResult, sessionResult]) => {
        if (!active) return
        if (reviewsResult.status === "fulfilled") {
          const loaded = reviewsResult.value
          setReviews(loaded)
          setSelectedId((current) =>
            loaded.some((review) => review.id === current)
              ? current
              : (loaded[0]?.id ?? "")
          )
          setApiStatus("connected")
        } else {
          setApiStatus("error")
        }
        if (sessionResult.status === "fulfilled") {
          setSession(sessionResult.value.session)
        }
      }
    )
    return () => {
      active = false
    }
  }, [])

  function navigate(view: View) {
    setActiveView(view)
  }

  const organisationName = session?.organisationName ?? "Your organisation"
  const displayName = session?.displayName ?? "Account"

  return (
    <AppShell
      activeView={activeView}
      onNavigate={navigate}
      apiStatus={apiStatus}
      session={session}
    >
      {activeView === "overview" ? (
        <OverviewView
          reviews={reviews}
          onNavigate={navigate}
          displayName={displayName}
          organisationName={organisationName}
        />
      ) : null}
      {activeView === "reviews" ? (
        <ReviewsWorkspace
          reviews={reviews}
          setReviews={setReviews}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          apiStatus={apiStatus}
          onRefresh={refreshReviews}
        />
      ) : null}
      {activeView === "menu" ? (
        <MenuAssistantView onNavigate={() => navigate("connections")} />
      ) : null}
      {activeView === "analytics" ? <AnalyticsView /> : null}
      {activeView === "connections" ? (
        <ConnectionsView onNavigate={() => navigate("settings")} />
      ) : null}
      {activeView === "settings" ? <SettingsView /> : null}
    </AppShell>
  )
}
