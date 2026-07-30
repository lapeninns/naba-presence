"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

import { AppShell } from "@/components/naba-presence/app-shell"
import { REVIEW_WORKFLOW_STATES } from "@/lib/domain/workflow"
import { Review } from "@/lib/naba-presence-data"
import {
  type AppSession,
  loadConnections,
  loadReviewCounts,
  loadReviews,
  loadSession,
  type ReviewCounts,
} from "@/lib/naba-presence-api"

export type ApiStatus =
  | "loading"
  | "connected"
  | "stale"
  | "disconnected"
  | "error"

export type ConnectionState = "loading" | "connected" | "disconnected"

function emptyReviewCounts(): ReviewCounts {
  return {
    total: 0,
    byStatus: Object.fromEntries(
      REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
    ) as ReviewCounts["byStatus"],
  }
}

type DashboardContextValue = {
  reviews: Review[]
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>
  selectedId: string
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  apiStatus: ApiStatus
  counts: ReviewCounts
  refreshCounts: (locationId?: string) => Promise<void>
  connectionState: ConnectionState
  lastRefreshedAt: number | null
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
  const pathname = usePathname()
  const [reviews, setReviews] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading")
  const [counts, setCounts] = useState<ReviewCounts>(emptyReviewCounts)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("loading")
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [session, setSession] = useState<AppSession | null>(null)
  const mountedRef = useRef(true)
  const hasSuccessfulRefreshRef = useRef(false)
  const lastRefreshedAtRef = useRef<number | null>(null)
  const countsLocationIdRef = useRef<string | undefined>(undefined)
  const connectionStateRef = useRef<ConnectionState>("loading")

  const refreshDashboard = useCallback(async (includeReviews: boolean) => {
    const [countsResult, connectionsResult, reviewsResult] =
      await Promise.allSettled([
        loadReviewCounts(countsLocationIdRef.current),
        loadConnections(),
        includeReviews ? loadReviews() : Promise.resolve(null),
      ])
    if (!mountedRef.current) return

    if (countsResult.status === "fulfilled") {
      setCounts(countsResult.value)
    }
    let nextConnectionState = connectionStateRef.current
    if (connectionsResult.status === "fulfilled") {
      nextConnectionState = connectionsResult.value.connections.some(
        (connection) => connection.status === "active"
      )
        ? "connected"
        : "disconnected"
      connectionStateRef.current = nextConnectionState
      setConnectionState(nextConnectionState)
    }
    if (
      includeReviews &&
      reviewsResult.status === "fulfilled" &&
      reviewsResult.value
    ) {
      const loaded = reviewsResult.value
      setReviews(loaded)
      setSelectedId((current) =>
        loaded.some((review) => review.id === current)
          ? current
          : (loaded[0]?.id ?? "")
      )
    }

    const succeeded =
      countsResult.status === "fulfilled" &&
      connectionsResult.status === "fulfilled" &&
      reviewsResult.status === "fulfilled"
    if (succeeded) {
      const refreshedAt = Date.now()
      hasSuccessfulRefreshRef.current = true
      lastRefreshedAtRef.current = refreshedAt
      setLastRefreshedAt(refreshedAt)
      setApiStatus(
        nextConnectionState === "disconnected"
          ? "disconnected"
          : "connected"
      )
    } else {
      setApiStatus(hasSuccessfulRefreshRef.current ? "stale" : "error")
    }
  }, [])

  const refreshReviews = useCallback(async () => {
    await refreshDashboard(true)
  }, [refreshDashboard])

  const refreshCounts = useCallback(async (locationId?: string) => {
    countsLocationIdRef.current = locationId
    try {
      const loaded = await loadReviewCounts(locationId)
      if (!mountedRef.current) return
      setCounts(loaded)
    } catch {
      if (!mountedRef.current) return
      setApiStatus(hasSuccessfulRefreshRef.current ? "stale" : "error")
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshDashboard(true)
    void loadSession().then(
      ({ session: loadedSession }) => {
        if (mountedRef.current) setSession(loadedSession)
      },
      () => {
        if (mountedRef.current) setSession(null)
      }
    )
    return () => {
      mountedRef.current = false
    }
  }, [refreshDashboard])

  useEffect(() => {
    if (apiStatus === "error" && !hasSuccessfulRefreshRef.current) return

    const refreshVisibleData = () => {
      const refreshedAt = lastRefreshedAtRef.current
      if (refreshedAt && Date.now() - refreshedAt > 5 * 60_000) {
        setApiStatus("stale")
      }
      if (document.visibilityState !== "visible") return
      void refreshDashboard(
        pathname === "/inbox" || pathname.endsWith("/reviews")
      )
    }
    const interval = window.setInterval(refreshVisibleData, 60_000)
    window.addEventListener("focus", refreshVisibleData)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshVisibleData)
    }
  }, [apiStatus, pathname, refreshDashboard])

  return (
    <DashboardContext.Provider
      value={{
        reviews,
        setReviews,
        selectedId,
        setSelectedId,
        apiStatus,
        counts,
        refreshCounts,
        connectionState,
        lastRefreshedAt,
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
