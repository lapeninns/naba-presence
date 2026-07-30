"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  "loading" | "connected" | "stale" | "disconnected" | "error"

export type ConnectionState = "loading" | "connected" | "disconnected"
type DashboardRefreshMode = "data" | "bootstrap" | "queue-bootstrap" | "health"
type DashboardRefreshOptions = {
  includeReviews: boolean
  includeCounts?: boolean
  mode?: DashboardRefreshMode
  requestEpoch?: number
  queueToken?: QueueScopeToken
}
export type QueueScopeToken = Readonly<{ pathname: string }>

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
  queueScopeToken: QueueScopeToken | null
  refreshCounts: (
    queueToken: QueueScopeToken | null,
    locationId?: string
  ) => Promise<void>
  revalidateQueueConnection: (
    queueToken: QueueScopeToken | null
  ) => Promise<boolean>
  connectionState: ConnectionState
  lastRefreshedAt: number | null
  session: AppSession | null
  refreshReviews: (
    queueToken: QueueScopeToken | null,
    succeeded?: boolean
  ) => Promise<void>
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
  const reviewQueueToken = useMemo<QueueScopeToken | null>(
    () => (isReviewQueueRoute ? { pathname } : null),
    [isReviewQueueRoute, pathname]
  )
  const [reviews, setReviews] = useState<Review[]>([])
  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading")
  const [counts, setCounts] = useState<ReviewCounts>(emptyReviewCounts)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("loading")
  const [validatedQueueToken, setValidatedQueueToken] =
    useState<QueueScopeToken | null>(null)
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
  const currentQueueTokenRef = useRef<QueueScopeToken | null>(reviewQueueToken)
  const validatedQueueTokenRef = useRef<QueueScopeToken | null>(null)
  const successfulQueueTokenRef = useRef<QueueScopeToken | null>(null)
  const queueConnectionRequestIdRef = useRef(0)

  useLayoutEffect(() => {
    currentQueueTokenRef.current = reviewQueueToken
  }, [reviewQueueToken])

  const refreshDashboard = useCallback(
    async ({
      includeReviews,
      includeCounts = true,
      mode = "data",
      requestEpoch = dashboardEpochRef.current,
      queueToken,
    }: DashboardRefreshOptions) => {
      const queueConnectionRequestId =
        mode === "queue-bootstrap"
          ? ++queueConnectionRequestIdRef.current
          : queueConnectionRequestIdRef.current
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
      if (!mountedRef.current || requestEpoch !== dashboardEpochRef.current) {
        return
      }
      if (
        mode === "queue-bootstrap" &&
        (!queueToken ||
          queueToken !== currentQueueTokenRef.current ||
          queueConnectionRequestId !== queueConnectionRequestIdRef.current)
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
          const currentQueueToken = currentQueueTokenRef.current
          if (nextConnectionState === "disconnected") {
            lastReviewRefreshSucceededRef.current = false
            if (currentQueueToken) {
              successfulQueueTokenRef.current = null
            }
            setApiStatus("disconnected")
          } else if (previousConnectionState !== "connected") {
            const hasCurrentReviewData = currentQueueToken
              ? successfulQueueTokenRef.current === currentQueueToken
              : lastReviewRefreshSucceededRef.current
            setApiStatus(
              hasCurrentReviewData
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

      if (mode === "queue-bootstrap") {
        validatedQueueTokenRef.current = queueToken ?? null
        setValidatedQueueToken(queueToken ?? null)
        if (connectionsResult.status === "fulfilled") {
          if (nextConnectionState === "disconnected") {
            successfulQueueTokenRef.current = null
            lastReviewRefreshSucceededRef.current = false
            setApiStatus("disconnected")
          } else {
            setApiStatus(
              successfulQueueTokenRef.current === queueToken
                ? "connected"
                : "loading"
            )
          }
        } else {
          connectionStateRef.current = "loading"
          setConnectionState("loading")
          setApiStatus(
            successfulQueueTokenRef.current === queueToken ||
              hasSuccessfulRefreshRef.current
              ? "stale"
              : "error"
          )
        }
        return
      }

      if (mode === "bootstrap") {
        if (connectionsResult.status === "fulfilled") {
          setApiStatus(
            nextConnectionState === "disconnected"
              ? "disconnected"
              : "connected"
          )
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
          nextConnectionState === "disconnected" ? "disconnected" : "connected"
        )
      } else {
        lastReviewRefreshSucceededRef.current = false
        setApiStatus(hasSuccessfulRefreshRef.current ? "stale" : "error")
      }
    },
    []
  )

  const revalidateQueueConnection = useCallback(
    async (queueToken: QueueScopeToken | null) => {
      if (!queueToken || queueToken !== currentQueueTokenRef.current) {
        return false
      }

      successfulQueueTokenRef.current = null
      lastReviewRefreshSucceededRef.current = false
      countsRequestIdRef.current += 1
      validatedQueueTokenRef.current = null
      setValidatedQueueToken(null)
      setApiStatus("loading")
      await refreshDashboard({
        includeReviews: false,
        includeCounts: false,
        mode: "queue-bootstrap",
        requestEpoch: dashboardEpochRef.current,
        queueToken,
      })
      return (
        currentQueueTokenRef.current === queueToken &&
        validatedQueueTokenRef.current === queueToken &&
        connectionStateRef.current === "connected"
      )
    },
    [refreshDashboard]
  )

  const refreshReviews = useCallback(
    async (queueToken: QueueScopeToken | null, succeeded = true) => {
      if (
        !mountedRef.current ||
        !queueToken ||
        queueToken !== currentQueueTokenRef.current ||
        queueToken !== validatedQueueTokenRef.current
      ) {
        return
      }
      if (!succeeded) {
        successfulQueueTokenRef.current = null
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
      successfulQueueTokenRef.current = queueToken
      lastRefreshedAtRef.current = refreshedAt
      setLastRefreshedAt(refreshedAt)
      setApiStatus(
        connectionStateRef.current === "connected"
          ? "connected"
          : connectionStateRef.current === "disconnected"
            ? "disconnected"
            : "stale"
      )
    },
    []
  )

  const refreshCounts = useCallback(
    async (queueToken: QueueScopeToken | null, locationId?: string) => {
      if (
        !queueToken ||
        queueToken !== currentQueueTokenRef.current ||
        queueToken !== validatedQueueTokenRef.current
      ) {
        throw new Error("Review counts request has no current queue owner.")
      }

      countsLocationIdRef.current = locationId
      const requestId = ++countsRequestIdRef.current
      try {
        const loaded = await loadReviewCounts(locationId)
        if (!mountedRef.current) return
        if (
          requestId !== countsRequestIdRef.current ||
          queueToken !== currentQueueTokenRef.current ||
          queueToken !== validatedQueueTokenRef.current
        ) {
          throw new Error("Review counts request was superseded.")
        }
        setCounts(loaded)
      } catch (error) {
        if (!mountedRef.current) return
        if (
          requestId === countsRequestIdRef.current &&
          queueToken === currentQueueTokenRef.current &&
          queueToken === validatedQueueTokenRef.current
        ) {
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
    },
    []
  )

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
      mode: dashboardRouteMode === "queue" ? "queue-bootstrap" : "bootstrap",
      requestEpoch,
      queueToken: reviewQueueToken ?? undefined,
    })
  }, [dashboardRouteMode, refreshDashboard, reviewQueueToken])

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

  const queueConnectionIsValidated =
    !reviewQueueToken || validatedQueueToken === reviewQueueToken
  const visibleApiStatus = queueConnectionIsValidated ? apiStatus : "loading"
  const visibleConnectionState = queueConnectionIsValidated
    ? connectionState
    : "loading"

  return (
    <DashboardContext.Provider
      value={{
        reviews,
        apiStatus: visibleApiStatus,
        counts,
        queueScopeToken: reviewQueueToken,
        refreshCounts,
        revalidateQueueConnection,
        connectionState: visibleConnectionState,
        lastRefreshedAt,
        session,
        refreshReviews,
      }}
    >
      <AppShell apiStatus={visibleApiStatus} session={session}>
        {children}
      </AppShell>
    </DashboardContext.Provider>
  )
}
