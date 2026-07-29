"use client"

import { createContext, useContext, useEffect, useState } from "react"

import { AppShell } from "@/components/naba-presence/app-shell"
import { Review } from "@/lib/naba-presence-data"
import {
  type AppSession,
  loadReviews,
  loadSession,
} from "@/lib/naba-presence-api"

type DashboardContextValue = {
  reviews: Review[]
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>
  selectedId: string
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  apiStatus: "loading" | "connected" | "error"
  session: AppSession | null
  refreshReviews: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useNabaPresenceDashboard() {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error(
      "useNabaPresenceDashboard must be used within NabaPresenceDashboard."
    )
  }
  return context
}

export function NabaPresenceDashboard({
  children,
}: {
  children: React.ReactNode
}) {
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

  return (
    <DashboardContext.Provider
      value={{
        reviews,
        setReviews,
        selectedId,
        setSelectedId,
        apiStatus,
        session,
        refreshReviews,
      }}
    >
      <AppShell apiStatus={apiStatus} session={session}>
        {children}
      </AppShell>
    </DashboardContext.Provider>
  )
}
