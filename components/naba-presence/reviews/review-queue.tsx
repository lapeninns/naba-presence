"use client"

import { Activity, RefreshCw, Search } from "lucide-react"
import Link from "next/link"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import type {
  ApiStatus,
  ConnectionState,
  QueueScopeToken,
} from "@/components/naba-presence/review-app"
import { ReviewDetail } from "@/components/naba-presence/reviews/review-detail"
import { ReviewFilters } from "@/components/naba-presence/reviews/review-filters"
import { ReviewList } from "@/components/naba-presence/reviews/review-list"
import {
  EMPTY_REVIEW_COUNTS,
  mergeLocationDirectory,
  relativeRefreshTime,
  useQueueRefreshReadiness,
} from "@/components/naba-presence/reviews/review-queue-state"
import { cn } from "@/lib/utils"
import { Review, ReviewStatus } from "@/lib/naba-presence-data"
import {
  loadLocations,
  loadReviewsPage,
  type ReviewCounts,
} from "@/lib/naba-presence-api"
import { PageHeader } from "@/components/naba-presence/shared"

export type Queue = "all" | ReviewStatus

export function ReviewQueue({
  reviews,
  setReviews,
  selectedId,
  setSelectedId,
  apiStatus,
  counts,
  queueScopeToken,
  refreshCounts,
  revalidateConnection,
  connectionState,
  lastRefreshedAt,
  onRefresh,
  locationId,
  heading,
}: {
  reviews: Review[]
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>
  selectedId: string
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  apiStatus: ApiStatus
  counts: ReviewCounts
  queueScopeToken: QueueScopeToken | null
  refreshCounts: (
    queueToken: QueueScopeToken | null,
    locationId?: string
  ) => Promise<void>
  revalidateConnection: (queueToken: QueueScopeToken | null) => Promise<boolean>
  connectionState: ConnectionState
  lastRefreshedAt: number | null
  onRefresh: (
    queueToken: QueueScopeToken | null,
    succeeded?: boolean
  ) => Promise<void>
  locationId?: string
  heading: {
    title: string
    description: string
  }
}) {
  const [queue, setQueue] = useState<Queue>("all")
  const [location, setLocation] = useState("All locations")
  const [rating, setRating] = useState("all")
  const [query, setQuery] = useState("")
  const [dateRange, setDateRange] = useState("all")
  const [replyState, setReplyState] = useState("all")
  const [verification, setVerification] = useState("all")
  const [publishState, setPublishState] = useState("all")
  const [syncState, setSyncState] = useState("all")
  const [sort, setSort] = useState<
    "updated_desc" | "rating_desc" | "rating_asc"
  >("updated_desc")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filterAnchor] = useState(() => Date.now())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [knownLocations, setKnownLocations] = useState(
    () =>
      new Map(
        reviews.flatMap((review) =>
          review.locationId
            ? ([[review.location, review.locationId]] as const)
            : []
        )
      )
  )
  const [isFiltering, startFiltering] = useTransition()
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list")
  const [resolvedCountsScope, setResolvedCountsScope] = useState<string | null>(
    null
  )
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const reviewsRequestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const reportQueueRefresh = useCallback(
    (succeeded = true) => onRefresh(queueScopeToken, succeeded),
    [onRefresh, queueScopeToken]
  )
  const {
    beginCombined,
    beginCounts,
    beginReviews,
    completeCombined,
    completeCounts,
    completeReviews,
  } = useQueueRefreshReadiness(reportQueueRefresh)
  const deferredQuery = useDeferredValue(query)
  const locationDirectory = useMemo(
    () => mergeLocationDirectory(knownLocations, reviews),
    [knownLocations, reviews]
  )
  const locationItems = useMemo(
    () => ["All locations", ...locationDirectory.keys()],
    [locationDirectory]
  )
  const selectedLocationId =
    location === "All locations" ? undefined : locationDirectory.get(location)
  const effectiveLocationId = locationId ?? selectedLocationId
  const countsScope = effectiveLocationId ?? "all-locations"
  const visibleCounts =
    resolvedCountsScope === countsScope ? counts : EMPTY_REVIEW_COUNTS
  const hasServerData = connectionState !== "loading"

  const serverFilters = useMemo(() => {
    const workflowByQueue: Record<Queue, string[] | undefined> = {
      all: undefined,
      needs_reply: ["new", "drafted", "verified"],
      awaiting_approval: ["awaiting_approval", "publish_requested"],
      escalated: ["escalated", "rejected", "failed"],
      published: ["published"],
    }
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : null
    return {
      locationId: effectiveLocationId,
      ratings: rating === "all" ? undefined : [Number(rating)],
      statuses: workflowByQueue[queue],
      replyStates: replyState === "all" ? undefined : [replyState],
      verificationStatuses: verification === "all" ? undefined : [verification],
      publishStatuses: publishState === "all" ? undefined : [publishState],
      syncStatuses: syncState === "all" ? undefined : [syncState],
      dateFrom: days
        ? new Date(filterAnchor - days * 86_400_000).toISOString()
        : undefined,
      search: deferredQuery.trim() || undefined,
      sort,
    }
  }, [
    dateRange,
    deferredQuery,
    effectiveLocationId,
    filterAnchor,
    publishState,
    queue,
    rating,
    replyState,
    sort,
    syncState,
    verification,
  ])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reviewsRequestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadLocations()
      .then(({ locations }) => {
        if (!active) return
        setKnownLocations(
          new Map(locations.map((item) => [item.name, item.id]))
        )
      })
      .catch(() => {
        // Reviews remain a safe directory fallback while this request loads.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!hasServerData) return
    let active = true
    beginCounts()
    void refreshCounts(queueScopeToken, effectiveLocationId).then(
      () => {
        if (active) {
          setResolvedCountsScope(countsScope)
          completeCounts(countsScope)
        }
      },
      () => {
        // Keep previous-scope totals hidden when a scoped request fails.
      }
    )
    return () => {
      active = false
    }
  }, [
    beginCounts,
    completeCounts,
    countsScope,
    effectiveLocationId,
    hasServerData,
    queueScopeToken,
    refreshCounts,
  ])

  useEffect(() => {
    const requestId = ++reviewsRequestIdRef.current
    if (!hasServerData) return
    beginReviews()
    const timeout = window.setTimeout(() => {
      startFiltering(async () => {
        try {
          const page = await loadReviewsPage(serverFilters)
          if (
            !mountedRef.current ||
            requestId !== reviewsRequestIdRef.current
          ) {
            return
          }
          setKnownLocations((current) =>
            mergeLocationDirectory(current, page.items)
          )
          setReviews(page.items)
          setNextCursor(page.nextCursor)
          setSelectedId((current) =>
            page.items.some((review) => review.id === current)
              ? current
              : (page.items[0]?.id ?? "")
          )
          completeReviews(countsScope)
        } catch {
          if (mountedRef.current && requestId === reviewsRequestIdRef.current) {
            void onRefresh(queueScopeToken, false)
          }
          // Preserve the last successful inbox state during a transient failure.
        }
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [
    beginReviews,
    completeReviews,
    countsScope,
    hasServerData,
    onRefresh,
    queueScopeToken,
    serverFilters,
    setReviews,
    setSelectedId,
  ])

  useEffect(() => {
    if (!hasServerData) return

    const refreshVisibleQueue = () => {
      if (document.visibilityState !== "visible") return
      const requestId = ++reviewsRequestIdRef.current
      beginCombined()
      startFiltering(async () => {
        const countsRequest = refreshCounts(
          queueScopeToken,
          effectiveLocationId
        ).then(() => {
          if (!mountedRef.current) return
          setResolvedCountsScope(countsScope)
          completeCounts(countsScope)
        })
        const [pageResult, countsResult] = await Promise.allSettled([
          loadReviewsPage(serverFilters),
          countsRequest,
        ])
        if (!mountedRef.current || requestId !== reviewsRequestIdRef.current) {
          return
        }
        await completeCombined(
          countsScope,
          pageResult.status === "fulfilled",
          countsResult.status === "fulfilled"
        )
        if (!mountedRef.current || requestId !== reviewsRequestIdRef.current) {
          return
        }
        if (pageResult.status !== "fulfilled") return

        const page = pageResult.value
        setKnownLocations((current) =>
          mergeLocationDirectory(current, page.items)
        )
        setReviews(page.items)
        setNextCursor(page.nextCursor)
        setSelectedId((current) =>
          page.items.some((review) => review.id === current)
            ? current
            : (page.items[0]?.id ?? "")
        )
      })
    }

    const interval = window.setInterval(refreshVisibleQueue, 60_000)
    window.addEventListener("focus", refreshVisibleQueue)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshVisibleQueue)
    }
  }, [
    beginCombined,
    completeCombined,
    completeCounts,
    countsScope,
    effectiveLocationId,
    hasServerData,
    onRefresh,
    queueScopeToken,
    refreshCounts,
    serverFilters,
    setReviews,
    setSelectedId,
  ])

  const filteredReviews = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return reviews.filter((review) => {
      const matchesFixedLocation =
        !locationId || review.locationId === locationId
      const matchesQueue =
        hasServerData || queue === "all" || review.status === queue
      const matchesLocation =
        hasServerData ||
        location === "All locations" ||
        review.location === location
      const matchesRating =
        hasServerData ||
        rating === "all" ||
        review.rating === Number.parseInt(rating)
      const matchesQuery =
        hasServerData ||
        !normalizedQuery ||
        `${review.reviewer} ${review.text} ${review.location}`
          .toLowerCase()
          .includes(normalizedQuery)
      return (
        matchesFixedLocation &&
        matchesQueue &&
        matchesLocation &&
        matchesRating &&
        matchesQuery
      )
    })
  }, [
    deferredQuery,
    hasServerData,
    location,
    locationId,
    queue,
    rating,
    reviews,
  ])

  function clearFilters() {
    setQuery("")
    setLocation("All locations")
    setRating("all")
    setDateRange("all")
    setReplyState("all")
    setVerification("all")
    setPublishState("all")
    setSyncState("all")
    setSort("updated_desc")
  }

  function loadMore() {
    if (!nextCursor) return
    const requestId = ++reviewsRequestIdRef.current
    startFiltering(async () => {
      try {
        const page = await loadReviewsPage(serverFilters, nextCursor)
        if (!mountedRef.current || requestId !== reviewsRequestIdRef.current) {
          return
        }
        setKnownLocations((current) =>
          mergeLocationDirectory(current, page.items)
        )
        setReviews((current) => {
          const byId = new Map(current.map((review) => [review.id, review]))
          for (const review of page.items) byId.set(review.id, review)
          return [...byId.values()]
        })
        setNextCursor(page.nextCursor)
      } catch {
        // Leave the current page intact.
      }
    })
  }

  async function reloadCurrentQueue() {
    reviewsRequestIdRef.current += 1
    await revalidateConnection(queueScopeToken)
  }

  const selectedReview =
    filteredReviews.find((review) => review.id === selectedId) ??
    filteredReviews[0]

  function selectReview(id: string) {
    setSelectedId(id)
    setMobilePane("detail")
    if (window.matchMedia("(max-width: 1279px)").matches) {
      window.requestAnimationFrame(() => backButtonRef.current?.focus())
    }
  }

  function returnToList() {
    setMobilePane("list")
    window.requestAnimationFrame(() => selectedRowRef.current?.focus())
  }

  return (
    <Tabs
      value={queue}
      onValueChange={(value) => setQueue(value as Queue)}
      className="flex h-[calc(100svh-4rem)] min-h-0 flex-col gap-0"
    >
      <div className="flex shrink-0 flex-col gap-4 px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)">
        <PageHeader
          title={heading.title}
          description={heading.description}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void reloadCurrentQueue()}
            >
              <RefreshCw data-icon="inline-start" />
              {apiStatus === "connected"
                ? "Live data"
                : apiStatus === "loading"
                  ? "Connecting"
                  : apiStatus === "disconnected"
                    ? "Google disconnected"
                    : "Retry live data"}
            </Button>
          }
        />

        {apiStatus === "error" ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Live review data is unavailable</AlertTitle>
            <AlertDescription>
              NabaPresence will not substitute preview records. Check the
              connection, then retry.
            </AlertDescription>
          </Alert>
        ) : null}

        {apiStatus === "stale" ? (
          <Alert className="border-rating/45 bg-rating/10">
            <Activity className="text-rating" />
            <AlertTitle>Data may be out of date</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>Last updated {relativeRefreshTime(lastRefreshedAt)}.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reloadCurrentQueue()}
              >
                <RefreshCw data-icon="inline-start" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {connectionState === "disconnected" ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>No active Google connection</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>
                Connect Google Business Profile to resume live review updates.
              </span>
              <Button
                render={<Link href="/settings/connections" />}
                variant="outline"
                size="sm"
              >
                Manage connections
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <ReviewFilters
          queue={queue}
          onQueueChange={setQueue}
          counts={visibleCounts}
          rating={rating}
          onRatingChange={setRating}
          query={query}
          onQueryChange={setQuery}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          replyState={replyState}
          onReplyStateChange={setReplyState}
          verification={verification}
          onVerificationChange={setVerification}
          publishState={publishState}
          onPublishStateChange={setPublishState}
          syncState={syncState}
          onSyncStateChange={setSyncState}
          sort={sort}
          onSortChange={setSort}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          onReset={clearFilters}
          showLocationFilter={!locationId}
          location={location}
          onLocationChange={setLocation}
          locationItems={locationItems}
        />
      </div>

      <TabsContent
        value={queue}
        className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(340px,0.78fr)_minmax(520px,1.4fr)]"
      >
        <section
          aria-label="Review list"
          className={cn(
            "min-h-0 border-r",
            mobilePane === "detail" ? "hidden xl:block" : "block"
          )}
        >
          <ScrollArea className="h-full">
            {filteredReviews.length ? (
              <ReviewList
                reviews={filteredReviews}
                selectedId={selectedReview?.id ?? ""}
                onSelect={selectReview}
                selectedRowRef={selectedRowRef}
              />
            ) : (
              <Empty className="min-h-80 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle role="heading" aria-level={2}>
                    No reviews found
                  </EmptyTitle>
                  <EmptyDescription>
                    Try changing your filters or search.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
            {hasServerData && nextCursor ? (
              <div className="p-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={loadMore}
                  disabled={isFiltering}
                >
                  {isFiltering ? <Spinner data-icon="inline-start" /> : null}
                  Load more reviews
                </Button>
              </div>
            ) : null}
          </ScrollArea>
        </section>

        <section
          aria-label="Selected review"
          className={cn(
            "min-h-0",
            mobilePane === "list" ? "hidden xl:block" : "block"
          )}
        >
          <ScrollArea className="h-full">
            {selectedReview ? (
              <ReviewDetail
                key={selectedReview.id}
                review={selectedReview}
                onBack={returnToList}
                backButtonRef={backButtonRef}
                onRefreshData={reloadCurrentQueue}
                onUpdate={(patch) =>
                  setReviews((current) =>
                    current.map((review) =>
                      review.id === selectedReview.id
                        ? { ...review, ...patch }
                        : review
                    )
                  )
                }
              />
            ) : (
              <Empty className="min-h-96 border-0">
                <EmptyHeader>
                  {/* A real heading role: the a11y suite looks for a
                      heading inside the "Selected review" region even
                      when nothing is selected; `EmptyTitle` is a plain
                      `<div>` by default. */}
                  <EmptyTitle role="heading" aria-level={2}>
                    No review selected
                  </EmptyTitle>
                  <EmptyDescription>
                    Connect Google and link a verified location to begin.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={returnToList}>
                    Back to reviews
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </ScrollArea>
        </section>
      </TabsContent>
    </Tabs>
  )
}
