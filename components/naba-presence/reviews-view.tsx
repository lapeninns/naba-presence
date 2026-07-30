"use client"

import {
  Activity,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  ApiStatus,
  ConnectionState,
} from "@/components/naba-presence/review-app"
import { ReviewDetail } from "@/components/naba-presence/reviews/review-detail"
import { cn } from "@/lib/utils"
import { Review, ReviewStatus } from "@/lib/naba-presence-data"
import {
  loadLocations,
  type ReviewCounts,
  loadReviewsPage,
} from "@/lib/naba-presence-api"
import {
  PageHeader,
  readControlValue,
  Stars,
  StatusBadge,
} from "@/components/naba-presence/shared"

type Queue = "all" | ReviewStatus

function queueCount(queue: Queue, counts: ReviewCounts) {
  if (queue === "all") return counts.total
  if (queue === "needs_reply") {
    return (
      counts.byStatus.new +
      counts.byStatus.drafted +
      counts.byStatus.verified
    )
  }
  if (queue === "awaiting_approval") {
    return (
      counts.byStatus.awaiting_approval + counts.byStatus.publish_requested
    )
  }
  if (queue === "escalated") {
    return (
      counts.byStatus.escalated +
      counts.byStatus.rejected +
      counts.byStatus.failed
    )
  }
  return counts.byStatus.published
}

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

const QUEUES: { id: Queue; label: string }[] = [
  { id: "all", label: "All reviews" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "awaiting_approval", label: "Awaiting approval" },
  { id: "escalated", label: "Escalated" },
  { id: "published", label: "Published" },
]

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

  const activeFilterCount = [
    dateRange !== "all",
    replyState !== "all",
    verification !== "all",
    publishState !== "all",
    syncState !== "all",
  ].filter(Boolean).length

  const activeFilters = [
    dateRange !== "all" && {
      key: "date",
      label: dateRange === "7d" ? "Last 7 days" : "Last 30 days",
      clear: () => setDateRange("all"),
    },
    replyState !== "all" && {
      key: "reply",
      label: replyState === "replied" ? "Replied" : "Unreplied",
      clear: () => setReplyState("all"),
    },
    verification !== "all" && {
      key: "verification",
      label: `Verification: ${verification}`,
      clear: () => setVerification("all"),
    },
    publishState !== "all" && {
      key: "publish",
      label: publishState.replaceAll("_", " "),
      clear: () => setPublishState("all"),
    },
    syncState !== "all" && {
      key: "sync",
      label: `Sync: ${syncState}`,
      clear: () => setSyncState("all"),
    },
  ].filter((filter): filter is Exclude<typeof filter, false> => Boolean(filter))

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

        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
          <TabsList
            variant="line"
            aria-label="Review queues"
            className="grid h-auto! w-full grid-cols-2 justify-stretch gap-1 sm:grid-cols-3 xl:flex xl:h-8! xl:[scrollbar-width:none] xl:justify-start xl:overflow-x-auto xl:[&::-webkit-scrollbar]:hidden"
          >
            {QUEUES.map((item) => {
              const count = queueCount(item.id, counts)
              return (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  aria-label={`${item.label}, ${count}`}
                  // `TabsTrigger`'s inactive-state `text-foreground/60` fails
                  // WCAG AA contrast against a white surface in light mode
                  // (confirmed via axe: color-contrast, 4.29:1 vs required
                  // 4.5:1). `text-muted-foreground` is the theme's tuned
                  // secondary-text token; the component's own
                  // `data-active:text-foreground` still wins once active.
                  className="w-full min-w-0 px-2 text-xs text-muted-foreground xl:w-auto xl:flex-none xl:shrink-0 xl:px-3 xl:text-sm"
                >
                  {item.label}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {count}
                  </span>
                </TabsTrigger>
              )
            })}
          </TabsList>

          <div className="flex flex-1 flex-wrap items-center gap-2 2xl:justify-end">
            <InputGroup className="min-w-[220px] flex-1 2xl:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(readControlValue(event))}
                placeholder="Search reviews"
                aria-label="Search reviews"
              />
            </InputGroup>
            <Combobox
              items={locationItems}
              value={location}
              onValueChange={(value) => setLocation(value ?? "All locations")}
            >
              <ComboboxInput
                placeholder="All locations"
                aria-label="Filter by location"
                className="w-44"
                // `ComboboxInput`'s built-in trigger button is icon-only with
                // no accessible name of its own (confirmed via axe:
                // `button-name`, critical). It doesn't expose a prop to
                // label that inner button, so hide it instead — typing
                // still opens and filters the popup.
                showTrigger={false}
              />
              <ComboboxContent>
                <ComboboxEmpty>No locations found.</ComboboxEmpty>
                <ComboboxList>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Select
              value={rating}
              onValueChange={(value) => {
                if (value) setRating(value)
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by rating">
                <SelectValue>
                  {rating === "all" ? "All ratings" : `${rating} stars`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All ratings</SelectItem>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <SelectItem key={value} value={`${value}`}>
                      {value} stars
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => {
                if (
                  value === "updated_desc" ||
                  value === "rating_desc" ||
                  value === "rating_asc"
                )
                  setSort(value)
              }}
            >
              <SelectTrigger size="sm" aria-label="Sort reviews">
                <SelectValue>
                  {sort === "updated_desc"
                    ? "Newest updated"
                    : sort === "rating_desc"
                      ? "Highest rating"
                      : "Lowest rating"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="updated_desc">Newest updated</SelectItem>
                  <SelectItem value="rating_desc">Highest rating</SelectItem>
                  <SelectItem value="rating_asc">Lowest rating</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger render={<Button variant="outline" size="sm" />}>
                <SlidersHorizontal data-icon="inline-start" />
                Filters
                {activeFilterCount > 0 ? (
                  <Badge variant="secondary" className="font-mono">
                    {activeFilterCount}
                  </Badge>
                ) : null}
              </SheetTrigger>
              {/* `!` forces this over the component's own
                  `data-[side=right]:w-3/4`, which otherwise wins on
                  specificity regardless of className order (confirmed via
                  DOM measurement: without `!` the sheet rendered at 75vw,
                  not 320px). */}
              <SheetContent side="right" className="w-[320px]!">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>
                    Narrow the review inbox. Changes apply immediately.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
                  <Field>
                    <FieldLabel htmlFor="filter-date">Date range</FieldLabel>
                    <Select
                      value={dateRange}
                      onValueChange={(value) => value && setDateRange(value)}
                    >
                      <SelectTrigger
                        id="filter-date"
                        size="sm"
                        aria-label="Filter by date range"
                        className="w-full"
                      >
                        <SelectValue>
                          {dateRange === "all"
                            ? "Any date"
                            : dateRange === "7d"
                              ? "Last 7 days"
                              : "Last 30 days"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">Any date</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="filter-reply">Reply state</FieldLabel>
                    <Select
                      value={replyState}
                      onValueChange={(value) => value && setReplyState(value)}
                    >
                      <SelectTrigger
                        id="filter-reply"
                        size="sm"
                        aria-label="Filter by reply state"
                        className="w-full"
                      >
                        <SelectValue>
                          {replyState === "all"
                            ? "Any reply"
                            : replyState === "replied"
                              ? "Replied"
                              : "Unreplied"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">Any reply</SelectItem>
                          <SelectItem value="replied">Replied</SelectItem>
                          <SelectItem value="unreplied">Unreplied</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="filter-verification">
                      Verification
                    </FieldLabel>
                    <Select
                      value={verification}
                      onValueChange={(value) => value && setVerification(value)}
                    >
                      <SelectTrigger
                        id="filter-verification"
                        size="sm"
                        aria-label="Filter by verification"
                        className="w-full"
                      >
                        <SelectValue>
                          {verification === "all"
                            ? "Any verification"
                            : `Verification: ${verification}`}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">Any verification</SelectItem>
                          <SelectItem value="pass">Passed</SelectItem>
                          <SelectItem value="warn">Warning</SelectItem>
                          <SelectItem value="fail">Failed</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="filter-publish">
                      Publish status
                    </FieldLabel>
                    <Select
                      value={publishState}
                      onValueChange={(value) => value && setPublishState(value)}
                    >
                      <SelectTrigger
                        id="filter-publish"
                        size="sm"
                        aria-label="Filter by publish status"
                        className="w-full"
                      >
                        <SelectValue>
                          {publishState === "all"
                            ? "Any publish status"
                            : publishState.replaceAll("_", " ")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">
                            Any publish status
                          </SelectItem>
                          <SelectItem value="not_published">
                            Not published
                          </SelectItem>
                          <SelectItem value="awaiting_approval">
                            Awaiting approval
                          </SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="filter-sync">Sync status</FieldLabel>
                    <Select
                      value={syncState}
                      onValueChange={(value) => value && setSyncState(value)}
                    >
                      <SelectTrigger
                        id="filter-sync"
                        size="sm"
                        aria-label="Filter by sync status"
                        className="w-full"
                      >
                        <SelectValue>
                          {syncState === "all"
                            ? "Any sync status"
                            : `Sync: ${syncState}`}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">Any sync status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="running">Running</SelectItem>
                          <SelectItem value="succeeded">Succeeded</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <SheetFooter>
                  <Button variant="outline" onClick={clearFilters}>
                    Clear all filters
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            {activeFilters.map((filter) => (
              <Badge
                key={filter.key}
                variant="secondary"
                className="gap-1 pr-1"
              >
                {filter.label}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${filter.label} filter`}
                  onClick={filter.clear}
                  className="size-4 rounded-full"
                >
                  <X />
                </Button>
              </Badge>
            ))}
          </div>
        </div>
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
              <ItemGroup className="gap-2.5 p-3 md:p-4">
                {filteredReviews.map((review) => (
                  <ReviewRow
                    key={review.id}
                    review={review}
                    selected={review.id === selectedReview?.id}
                    buttonRef={
                      review.id === selectedReview?.id
                        ? selectedRowRef
                        : undefined
                    }
                    onSelect={() => selectReview(review.id)}
                  />
                ))}
              </ItemGroup>
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

function ReviewRow({
  review,
  selected,
  buttonRef,
  onSelect,
}: {
  review: Review
  selected: boolean
  buttonRef?: React.Ref<HTMLButtonElement>
  onSelect: () => void
}) {
  return (
    // `ItemGroup` sets `role="list"`, which requires `listitem`-role owned
    // elements (axe `aria-required-children`, verified against this repo's
    // axe-core build). `Item`'s `render` prop replaces its whole root
    // element, so the button itself can't also carry `role="listitem"`
    // without losing its `button` role (breaking the a11y suite's
    // `getByRole("button")` row lookups). Wrapping keeps the row a real,
    // separately-queryable button while giving `ItemGroup` a valid child.
    <div role="listitem">
      <Item
        render={
          <button
            ref={buttonRef}
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
          />
        }
        size="sm"
        className={cn(
          "rounded-(--nr-radius-card) border-[var(--nr-surface-glass-border)] bg-[var(--nr-surface-card-translucent)] text-left shadow-(--nr-shadow-card) transition-[color,background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-(--nr-shadow-hover) motion-reduce:transform-none",
          selected
            ? "border-primary/45 bg-card"
            : "hover:border-border hover:bg-card/85"
        )}
      >
        <ItemMedia>
          <Avatar size="sm">
            <AvatarFallback>{review.initials}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <div className="flex w-full items-start justify-between gap-3">
            <ItemTitle>{review.reviewer}</ItemTitle>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {review.postedAt.split(",")[0]}
            </span>
          </div>
          <ItemDescription className="line-clamp-1">
            {review.location}
          </ItemDescription>
          <Stars value={review.rating} compact />
          <ItemDescription>{review.excerpt}</ItemDescription>
          <div className="mt-1">
            <StatusBadge status={review.status} />
          </div>
        </ItemContent>
      </Item>
    </div>
  )
}
