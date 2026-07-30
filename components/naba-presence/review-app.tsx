"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { usePathname } from "next/navigation"

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
type DashboardRefreshMode =
  | "data"
  | "bootstrap"
  | "queue-bootstrap"
  | "health"
type DashboardRefreshOptions = {
  includeReviews: boolean
  includeCounts?: boolean
  mode?: DashboardRefreshMode
  requestEpoch?: number
}

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
  apiStatus: ApiStatus
  counts: ReviewCounts
  refreshCounts: (locationId?: string) => Promise<void>
  connectionState: ConnectionState
  lastRefreshedAt: number | null
  session: AppSession | null
  refreshReviews: (succeeded?: boolean) => Promise<void>
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
  const isHomeRoute = pathname === "/home"
  const isReviewQueueRoute =
    pathname === "/inbox" ||
    /^\/locations\/[^/]+\/reviews(?:\/|$)/.test(pathname)
  const dashboardRouteMode = isHomeRoute
    ? "home"
    : isReviewQueueRoute
      ? "queue"
      : "other"
  const [reviews, setReviews] = useState<Review[]>([])
  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading")
  const [counts, setCounts] = useState<ReviewCounts>(emptyReviewCounts)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("loading")
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [session, setSession] = useState<AppSession | null>(null)
  const mountedRef = useRef(true)
  const hasSuccessfulRefreshRef = useRef(false)
  const lastReviewRefreshSucceededRef = useRef(false)
  const lastRefreshedAtRef = useRef<number | null>(null)
  const countsLocationIdRef = useRef<string | undefined>(undefined)
  const countsRequestIdRef = useRef(0)
  const connectionStateRef = useRef<ConnectionState>("loading")
  const dashboardEpochRef = useRef(0)

  const refreshDashboard = useCallback(async ({
    includeReviews,
    includeCounts = true,
    mode = "data",
    requestEpoch = dashboardEpochRef.current,
  }: DashboardRefreshOptions) => {
    const countsLocationId = countsLocationIdRef.current
    const countsRequestId = includeCounts
      ? ++countsRequestIdRef.current
      : countsRequestIdRef.current
    const [countsResult, connectionsResult, reviewsResult] =
      await Promise.allSettled([
        includeCounts
          ? loadReviewCounts(countsLocationId)
          : Promise.resolve(null),
        loadConnections(),
        includeReviews ? loadReviews() : Promise.resolve(null),
      ])
    if (
      !mountedRef.current ||
      requestEpoch !== dashboardEpochRef.current
    ) {
      return
    }

    if (
      includeCounts &&
      countsResult.status === "fulfilled" &&
      countsResult.value &&
      countsRequestId === countsRequestIdRef.current &&
      countsLocationId === countsLocationIdRef.current
    ) {
      setCounts(countsResult.value)
    }
    let nextConnectionState = connectionStateRef.current
    const previousConnectionState = connectionStateRef.current
    if (connectionsResult.status === "fulfilled") {
      nextConnectionState = connectionsResult.value.connections.some(
        (connection) => connection.status === "active"
      )
        ? "connected"
        : "disconnected"
      connectionStateRef.current = nextConnectionState
      setConnectionState(nextConnectionState)
      if (mode === "health") {
        if (nextConnectionState === "disconnected") {
          lastReviewRefreshSucceededRef.current = false
          setApiStatus("disconnected")
        } else if (previousConnectionState === "disconnected") {
          setApiStatus(
            lastReviewRefreshSucceededRef.current
              ? "connected"
              : hasSuccessfulRefreshRef.current
                ? "stale"
                : "error"
          )
        }
      }
    }
    if (
      includeReviews &&
      reviewsResult.status === "fulfilled" &&
      reviewsResult.value
    ) {
      const loaded = reviewsResult.value
      setReviews(loaded)
    }

    if (mode === "health") return

    if (mode === "bootstrap" || mode === "queue-bootstrap") {
      if (connectionsResult.status === "fulfilled") {
        if (nextConnectionState === "disconnected") {
          setApiStatus("disconnected")
        } else if (mode === "bootstrap") {
          setApiStatus("connected")
        } else if (previousConnectionState !== "connected") {
          setApiStatus("loading")
        }
      } else {
        setApiStatus(hasSuccessfulRefreshRef.current ? "stale" : "error")
      }
      return
    }

    const succeeded =
      (!includeCounts || countsResult.status === "fulfilled") &&
      connectionsResult.status === "fulfilled" &&
      (!includeReviews || reviewsResult.status === "fulfilled")
    if (succeeded) {
      const refreshedAt = Date.now()
      hasSuccessfulRefreshRef.current = true
      lastReviewRefreshSucceededRef.current = true
      lastRefreshedAtRef.current = refreshedAt
      setLastRefreshedAt(refreshedAt)
      setApiStatus(
        nextConnectionState === "disconnected"
          ? "disconnected"
          : "connected"
      )
    } else {
      lastReviewRefreshSucceededRef.current = false
      setApiStatus(hasSuccessfulRefreshRef.current ? "stale" : "error")
    }
  }, [])

  const refreshReviews = useCallback(async (succeeded = true) => {
    if (!mountedRef.current) return
    if (!succeeded) {
      lastReviewRefreshSucceededRef.current = false
      setApiStatus(
        connectionStateRef.current === "disconnected"
          ? "disconnected"
          : hasSuccessfulRefreshRef.current
            ? "stale"
            : "error"
      )
      return
    }

    const refreshedAt = Date.now()
    hasSuccessfulRefreshRef.current = true
    lastReviewRefreshSucceededRef.current = true
    lastRefreshedAtRef.current = refreshedAt
    setLastRefreshedAt(refreshedAt)
    setApiStatus(
      connectionStateRef.current === "disconnected"
        ? "disconnected"
        : "connected"
    )
  }, [])

  const refreshCounts = useCallback(async (locationId?: string) => {
    countsLocationIdRef.current = locationId
    const requestId = ++countsRequestIdRef.current
    try {
      const loaded = await loadReviewCounts(locationId)
      if (!mountedRef.current) return
      if (requestId !== countsRequestIdRef.current) {
        throw new Error("Review counts request was superseded.")
      }
      setCounts(loaded)
    } catch (error) {
      if (!mountedRef.current) return
      if (requestId === countsRequestIdRef.current) {
        setApiStatus(
          connectionStateRef.current === "disconnected"
            ? "disconnected"
            : hasSuccessfulRefreshRef.current
              ? "stale"
              : "error"
        )
      }
      throw error
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
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
      dashboardEpochRef.current += 1
    }
  }, [])

  useEffect(() => {
    const requestEpoch = ++dashboardEpochRef.current
    if (dashboardRouteMode === "home") {
      countsLocationIdRef.current = undefined
      void refreshDashboard({ includeReviews: true, requestEpoch })
      return
    }

    // Review queues own their scoped list and count requests. Other dashboard
    // routes only need connection health until Home requests its roll-up.
    void refreshDashboard({
      includeReviews: false,
      includeCounts: false,
      mode:
        dashboardRouteMode === "queue"
          ? "queue-bootstrap"
          : "bootstrap",
      requestEpoch,
    })
  }, [dashboardRouteMode, refreshDashboard])

  useEffect(() => {
    if (apiStatus === "error" && !hasSuccessfulRefreshRef.current) return

    const refreshVisibleData = () => {
      const refreshedAt = lastRefreshedAtRef.current
      if (refreshedAt && Date.now() - refreshedAt > 5 * 60_000) {
        setApiStatus("stale")
      }
      if (document.visibilityState !== "visible") return
      // ReviewQueue owns its active server filters. Refreshing the shared,
      // unfiltered review page here could overwrite a location-scoped queue;
      // the timestamp change prompts the mounted queue to reload its scope.
      void refreshDashboard({
        includeReviews: false,
        includeCounts: false,
        mode: "health",
        requestEpoch: dashboardEpochRef.current,
      })
    }
    const interval = window.setInterval(refreshVisibleData, 60_000)
    window.addEventListener("focus", refreshVisibleData)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshVisibleData)
    }
  }, [apiStatus, refreshDashboard])

  return (
    <DashboardContext.Provider
      value={{
        reviews,
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
