"use client"

import { Activity, RefreshCw, Search } from "lucide-react"
import Link from "next/link"
import {
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
} from "@/components/naba-presence/review-app"
import { ReviewDetail } from "@/components/naba-presence/reviews/review-detail"
import { ReviewFilters } from "@/components/naba-presence/reviews/review-filters"
import { ReviewList } from "@/components/naba-presence/reviews/review-list"
import { cn } from "@/lib/utils"
import { Review, ReviewStatus } from "@/lib/naba-presence-data"
import {
  loadLocations,
  loadReviewsPage,
  type ReviewCounts,
} from "@/lib/naba-presence-api"
import { PageHeader } from "@/components/naba-presence/shared"

export type Queue = "all" | ReviewStatus

function relativeRefreshTime(value: number | null) {
  if (!value) return "never"
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  if (elapsedSeconds < 60) return "just now"
  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`
  }
  const elapsedHours = Math.round(elapsedMinutes / 60)
  return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`
}

function mergeLocationDirectory(
  current: Map<string, string>,
  reviews: Review[]
) {
  const next = new Map(current)
  for (const review of reviews) {
    if (review.locationId) next.set(review.location, review.locationId)
  }
  return next
}

export function ReviewsWorkspace({
  reviews,
  setReviews,
  selectedId,
  setSelectedId,
  apiStatus,
  counts,
  refreshCounts,
  connectionState,
  lastRefreshedAt,
  onRefresh,
}: {
  reviews: Review[]
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>
  selectedId: string
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  apiStatus: ApiStatus
  counts: ReviewCounts
  refreshCounts: (locationId?: string) => Promise<void>
  connectionState: ConnectionState
  lastRefreshedAt: number | null
  onRefresh: () => Promise<void>
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
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
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
  const hasServerData =
    apiStatus === "connected" ||
    apiStatus === "stale" ||
    apiStatus === "disconnected"

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
      locationId: selectedLocationId,
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
    filterAnchor,
    publishState,
    queue,
    rating,
    replyState,
    selectedLocationId,
    sort,
    syncState,
    verification,
  ])

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
    void refreshCounts(selectedLocationId)
  }, [hasServerData, refreshCounts, selectedLocationId])

  useEffect(() => {
    if (!hasServerData) return
    const timeout = window.setTimeout(() => {
      startFiltering(async () => {
        try {
          const page = await loadReviewsPage(serverFilters)
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
        } catch {
          // Preserve the last successful inbox state during a transient failure.
        }
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [hasServerData, serverFilters, setReviews, setSelectedId])

  const filteredReviews = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return reviews.filter((review) => {
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
      return matchesQueue && matchesLocation && matchesRating && matchesQuery
    })
  }, [deferredQuery, hasServerData, location, queue, rating, reviews])

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
    startFiltering(async () => {
      try {
        const page = await loadReviewsPage(serverFilters, nextCursor)
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

  const selectedReview =
    reviews.find((review) => review.id === selectedId) ?? reviews[0]

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
          title="Inbox"
          description="Google reviews awaiting a reply, approval, or publication across every linked location."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onRefresh()}
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
              <span>
                Last updated {relativeRefreshTime(lastRefreshedAt)}.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onRefresh()}
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
          counts={counts}
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
          showLocationFilter
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
                onRefreshData={async () => {
                  await Promise.all([
                    onRefresh(),
                    refreshCounts(selectedLocationId),
                  ])
                }}
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
              </Empty>
            )}
          </ScrollArea>
        </section>
      </TabsContent>
    </Tabs>
  )
}
