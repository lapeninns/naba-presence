"use client"

import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WandSparkles,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Separator } from "@/components/ui/separator"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type {
  ApiStatus,
  ConnectionState,
} from "@/components/naba-presence/review-app"
import type { DraftTone } from "@/lib/domain/reply-policy"
import { cn } from "@/lib/utils"
import { Review, ReviewStatus } from "@/lib/naba-presence-data"
import {
  approveReply,
  deleteReply,
  generateDraft,
  loadLocations,
  loadReviewDetail,
  type ReviewCounts,
  type ReviewDetailData,
  loadReviewsPage,
  publishDraft,
  rejectReply,
  saveDraft as saveDraftToApi,
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

const REPLY_LANGUAGES = [
  ["auto", "Auto (detected)"],
  ["en", "EN"],
  ["de", "DE"],
  ["es", "ES"],
  ["fr", "FR"],
  ["it", "IT"],
  ["pt", "PT"],
  ["nl", "NL"],
  ["ar", "AR"],
  ["ru", "RU"],
  ["ja", "JA"],
  ["hi", "HI"],
] as const

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
                render={<Link href="/connections" />}
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

function ReviewDetail({
  review,
  onBack,
  backButtonRef,
  onUpdate,
  onRefreshData,
}: {
  review: Review
  onBack: () => void
  backButtonRef: React.Ref<HTMLButtonElement>
  onUpdate: (patch: Partial<Review>) => void
  onRefreshData: () => Promise<void>
}) {
  const [draft, setDraft] = useState(review.draft)
  const [tone, setTone] = useState<DraftTone>("warm_professional")
  const [replyLanguage, setReplyLanguage] = useState("auto")
  const [feedback, setFeedback] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rejectionNote, setRejectionNote] = useState("")
  const [isPending, startTransition] = useTransition()
  const [detailState, setDetailState] = useState<{
    reviewId: string
    data: ReviewDetailData
  } | null>(null)
  const [detailError, setDetailError] = useState("")
  const detail = detailState?.reviewId === review.id ? detailState.data : null
  const languageOverride =
    replyLanguage === "auto" ? undefined : replyLanguage

  useEffect(() => {
    let active = true
    void loadReviewDetail(review.id)
      .then((value) => {
        if (active) setDetailState({ reviewId: review.id, data: value })
      })
      .catch((error) => {
        if (!active) return
        setDetailError(
          error instanceof Error
            ? error.message
            : "Review activity could not be loaded."
        )
      })
    return () => {
      active = false
    }
  }, [review.id])

  function regenerate() {
    setFeedback("")
    startTransition(async () => {
      try {
        const generated = await generateDraft(
          review.id,
          tone,
          languageOverride
        )
        setDraft(generated.body)
        onUpdate({
          draft: generated.body,
          draftId: generated.draftId,
          verification: generated.verification.verdict,
        })
        toast.add({
          type: "success",
          title: "A new verified draft is ready.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Draft generation failed."
        )
      }
    })
  }

  function saveDraft() {
    setFeedback("")
    startTransition(async () => {
      try {
        const saved = await saveDraftToApi(
          review.id,
          draft,
          tone,
          languageOverride
        )
        onUpdate({
          draft: saved.body,
          draftId: saved.draftId,
          verification: saved.verification.verdict,
        })
        toast.add({
          type: "success",
          title: "Draft saved",
          description: "Recorded in the review audit trail.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function publish() {
    setFeedback("")
    startTransition(async () => {
      try {
        const saved =
          !review.draftId ||
          draft !== review.draft ||
          languageOverride !== undefined
            ? await saveDraftToApi(
                review.id,
                draft,
                tone,
                languageOverride
              )
            : {
                draftId: review.draftId,
                body: draft,
                verification: { verdict: review.verification },
              }
        if (saved.verification.verdict === "fail") {
          onUpdate({ verification: "fail", draftId: saved.draftId, draft })
          throw new Error(
            "This reply failed verification and cannot be published."
          )
        }
        const published = await publishDraft(
          review.id,
          saved.draftId,
          review.sourceUpdateTime
        )
        const status =
          published.status === "awaiting_approval"
            ? "awaiting_approval"
            : published.status === "rejected"
              ? "escalated"
              : "published"
        onUpdate({
          draft,
          draftId: saved.draftId,
          verification: saved.verification.verdict,
          status,
          googleState: published.googleReplyState ?? undefined,
          ...(status === "published"
            ? { publishedReply: saved.body, responseTime: "Just now" }
            : {}),
        })
        toast.add({
          type: "success",
          title:
            status === "awaiting_approval"
              ? "Reply submitted for approval."
              : "Reply sent to Google.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Publish failed.")
      }
    })
  }

  function approve() {
    setFeedback("")
    startTransition(async () => {
      try {
        const approved = await approveReply(review.id)
        const status =
          approved.status === "rejected" ? "escalated" : "published"
        onUpdate({
          status,
          googleState: approved.googleReplyState ?? undefined,
          ...(status === "published"
            ? { publishedReply: draft, responseTime: "Just now" }
            : {}),
        })
        toast.add({
          type: "success",
          title:
            status === "published"
              ? "Reply approved and sent to Google."
              : "Google rejected the approved reply.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Approval failed.")
      }
    })
  }

  function rejectApproval() {
    setFeedback("")
    startTransition(async () => {
      try {
        await rejectReply(review.id, rejectionNote.trim() || undefined)
        onUpdate({ status: "needs_reply" })
        setRejectOpen(false)
        setRejectionNote("")
        toast.add({
          type: "success",
          title: "Reply returned to draft.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Rejection failed."
        )
      }
    })
  }

  function removePublishedReply() {
    setFeedback("")
    startTransition(async () => {
      try {
        await deleteReply(review.id)
        const refreshedDetail = await loadReviewDetail(review.id)
        setDetailState({ reviewId: review.id, data: refreshedDetail })
        onUpdate({
          status: "needs_reply",
          publishedReply: undefined,
          responseTime: undefined,
          googleState: undefined,
        })
        await onRefreshData()
        setDeleteOpen(false)
        toast.add({
          type: "success",
          title: "Published reply deleted",
          description: "The review is ready for a new reply.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Reply deletion failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-7 md:py-7">
      <header className="flex items-start gap-3 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5">
        <Button
          ref={backButtonRef}
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="xl:hidden"
          aria-label="Back to review list"
        >
          <ArrowLeft />
        </Button>
        <Avatar size="lg">
          <AvatarFallback>{review.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium">{review.reviewer}</h2>
            <StatusBadge status={review.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Stars value={review.rating} compact />
            <span>{review.location}</span>
            <span>Posted {review.postedAt.toLowerCase()}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Review actions"
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard
                  .writeText(review.id)
                  .then(() =>
                    toast.add({ type: "success", title: "Review ID copied" })
                  )
                  .catch(() => setFeedback("Review ID could not be copied."))
              }}
            >
              Copy review ID
            </DropdownMenuItem>
            {review.status === "published" || review.googleState ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                Delete published reply
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the reply on Google. The review returns to the
                inbox as unreplied.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={removePublishedReply}
                disabled={isPending}
              >
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Delete reply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      <section aria-label="Review conversation" className="flex flex-col gap-4">
        <div className="max-w-[92%] self-start rounded-(--nr-radius-card) rounded-tl-md border bg-muted p-4 md:max-w-[82%] md:p-5">
          <p className="text-sm leading-7">{review.text}</p>
        </div>
        <div className="flex flex-wrap gap-2 pl-1 text-xs text-muted-foreground">
          <span className="font-mono text-[11px]">
            Updated {review.updatedAt.toLowerCase()}
          </span>
          <span>·</span>
          <span>{review.language}</span>
        </div>

        {review.publishedReply ? (
          <div className="flex max-w-[92%] flex-col gap-2 self-end md:max-w-[82%]">
            <div className="rounded-(--nr-radius-card) rounded-tr-md border border-primary/25 bg-accent p-4 text-accent-foreground md:p-5">
              <p className="text-sm leading-7">{review.publishedReply}</p>
            </div>
            <p className="pr-1 text-right text-xs text-muted-foreground">
              Published business reply · {review.responseTime ?? "Published"}
            </p>
          </div>
        ) : null}
      </section>

      {detail?.media.length ? (
        <section className="flex flex-col gap-3" aria-label="Review media">
          <h3 className="text-sm font-medium">Review media</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.media.map((item) => (
              <a
                key={item.id}
                href={item.videoUrl ?? item.thumbnailUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border bg-muted/30"
              >
                {item.thumbnailUrl ? (
                  <span
                    className="block aspect-video bg-cover bg-center"
                    style={{ backgroundImage: `url("${item.thumbnailUrl}")` }}
                    role="img"
                    aria-label={item.thumbnailLabel ?? "Review media thumbnail"}
                  />
                ) : (
                  <span className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                    Open review video
                  </span>
                )}
                <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  {item.thumbnailLabel ?? (item.videoUrl ? "Video" : "Photo")}
                  <ArrowLeft className="size-3 rotate-135" aria-hidden />
                </span>
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Google replies support text only; media attachments are unavailable.
          </p>
        </section>
      ) : null}

      {review.status === "published" ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Reply published</AlertTitle>
          <AlertDescription>
            Google moderation: {review.googleState ?? "Not reported"} · Response
            time {review.responseTime ?? "Not available"}
          </AlertDescription>
        </Alert>
      ) : review.status === "escalated" ? (
        <Alert variant="destructive">
          <Activity />
          <AlertTitle>Escalation review required</AlertTitle>
          <AlertDescription>
            {detail?.reply?.googlePolicyViolation
              ? `Google rejected the reply: ${detail.reply.googlePolicyViolation}. Edit and verify it before publishing again.`
              : "This review should be checked by a manager before publishing. Verification can warn, but it cannot resolve the customer issue."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <section
          aria-labelledby="reply-draft-heading"
          className="flex min-w-0 flex-col gap-4 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <WandSparkles className="size-4 text-primary" aria-hidden />
              <h3 id="reply-draft-heading" className="text-sm font-semibold">
                Reply draft
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Field orientation="horizontal" className="w-auto gap-2">
                <FieldLabel htmlFor="reply-language">
                  Reply language
                </FieldLabel>
                <Select
                  value={replyLanguage}
                  onValueChange={(value) => {
                    if (value) setReplyLanguage(value)
                  }}
                >
                  <SelectTrigger id="reply-language" size="sm">
                    <SelectValue>
                      {REPLY_LANGUAGES.find(
                        ([code]) => code === replyLanguage
                      )?.[1] ?? "Auto (detected)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {REPLY_LANGUAGES.map(([code, label]) => (
                        <SelectItem key={code} value={code}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal" className="w-auto gap-2">
                <FieldLabel htmlFor="reply-tone">Tone</FieldLabel>
                <Select
                  value={tone}
                  onValueChange={(value) => {
                    if (value) setTone(value as DraftTone)
                  }}
                >
                  <SelectTrigger id="reply-tone" size="sm">
                    <SelectValue>
                      {tone === "warm_professional"
                        ? "Warm professional"
                        : tone === "concise"
                          ? "Concise"
                          : "Empathetic"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="warm_professional">
                        Warm professional
                      </SelectItem>
                      <SelectItem value="concise">Concise</SelectItem>
                      <SelectItem value="empathetic">Empathetic</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor={`reply-draft-${review.id}`}>
              Reply draft
            </FieldLabel>
            <Textarea
              id={`reply-draft-${review.id}`}
              key={review.id}
              value={draft}
              onChange={(event) => {
                setDraft(readControlValue(event))
                setFeedback("")
              }}
              rows={8}
              aria-describedby={`reply-count-${review.id}`}
              className="min-h-44 resize-y bg-background text-sm leading-6"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              id={`reply-count-${review.id}`}
              className="font-mono text-[11px] text-muted-foreground"
            >
              {new TextEncoder().encode(draft).length} / 4096 bytes
            </span>
            <span className="text-[11px] text-muted-foreground">
              Original language: {review.language}
            </span>
          </div>

          {feedback ? (
            <p
              className="text-xs text-destructive"
              role="status"
              aria-live="polite"
            >
              {feedback}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={regenerate} disabled={isPending}>
              {isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              Regenerate
            </Button>
            <Button
              variant="secondary"
              onClick={saveDraft}
              disabled={isPending || !draft.trim()}
            >
              Save draft
            </Button>
            <div className="flex w-full flex-col items-stretch gap-1.5 sm:ml-auto sm:w-auto sm:items-end">
              <p className="text-[11px] text-muted-foreground">
                Published replies are public on Google; approval may be
                required.
              </p>
              {review.status === "awaiting_approval" ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <AlertDialog
                    open={rejectOpen}
                    onOpenChange={setRejectOpen}
                  >
                    <AlertDialogTrigger
                      render={
                        <Button variant="outline" disabled={isPending}>
                          <X data-icon="inline-start" />
                          Reject
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Return reply to draft?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Add an optional note so the author knows what to
                          revise.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Textarea
                        value={rejectionNote}
                        onChange={(event) =>
                          setRejectionNote(event.target.value)
                        }
                        placeholder="Optional rejection note"
                        aria-label="Rejection note"
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={rejectApproval}>
                          Return to draft
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button onClick={approve} disabled={isPending}>
                    <Check data-icon="inline-start" />
                    Approve and publish
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={publish}
                  disabled={
                    isPending ||
                    review.verification === "pending" ||
                    review.verification === "fail" ||
                    !draft.trim()
                  }
                >
                  <Send data-icon="inline-start" />
                  {review.status === "published"
                    ? "Update reply"
                    : "Publish reply"}
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside
          aria-label="Reply lifecycle"
          className="flex flex-col gap-5 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5"
        >
          <VerificationPanel review={review} />
          <Separator />
          <ActivityTimeline events={detail?.timeline} error={detailError} />
        </aside>
      </div>
    </div>
  )
}

function VerificationPanel({ review }: { review: Review }) {
  const isWarning = review.verification === "warn"
  const isPending = review.verification === "pending"
  const isFailure = review.verification === "fail"
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Verification</h3>
        <Badge variant={isWarning || isFailure ? "destructive" : "secondary"}>
          {isPending
            ? "Pending"
            : isFailure
              ? "Failed"
              : isWarning
                ? "Review needed"
                : "Passed"}
        </Badge>
      </div>
      {isPending ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Generate or save the draft to run all deterministic checks.
        </p>
      ) : isFailure ? (
        <p className="text-xs leading-relaxed text-destructive">
          This draft is blocked. Edit it and save again to rerun verification.
        </p>
      ) : isWarning ? (
        <p className="text-xs leading-relaxed text-destructive">
          The latest stored verification requires a manager to review this draft
          before publishing.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The latest stored draft passed the configured verification checks.
        </p>
      )}
    </div>
  )
}

function ActivityTimeline({
  events: persistedEvents,
  error,
}: {
  events?: ReviewDetailData["timeline"]
  error?: string
}) {
  const events =
    persistedEvents?.slice(0, 8).map((event) => ({
      label: event.action
        .split(".")
        .map((part) => part.replaceAll("_", " "))
        .join(" · "),
      detail: event.createdAt,
      done: true,
    })) ?? []

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Activity</h3>
      {error ? (
        <p className="text-xs leading-relaxed text-destructive">{error}</p>
      ) : events.length ? (
        <ol className="flex flex-col">
          {events.map((event, index) => (
            <li
              key={event.label}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {index < events.length - 1 ? (
                <span className="absolute top-5 left-[9px] h-[calc(100%-0.25rem)] w-px bg-border" />
              ) : null}
              <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-background text-primary">
                <Check className="size-3" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{event.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {event.detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No activity has been recorded for this review.
        </p>
      )}
    </div>
  )
}
