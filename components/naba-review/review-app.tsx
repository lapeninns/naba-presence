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
  Sparkles,
  WandSparkles,
} from "lucide-react"
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"

import { AppShell } from "@/components/naba-review/app-shell"
import {
  AnalyticsView,
  ConnectionsView,
  OverviewView,
  SettingsView,
} from "@/components/naba-review/dashboard-views"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Review, ReviewStatus } from "@/lib/naba-review-data"
import {
  generateDraft,
  type AppSession,
  loadReviewDetail,
  type ReviewDetailData,
  loadReviews,
  loadReviewsPage,
  loadSession,
  publishDraft,
  saveDraft as saveDraftToApi,
} from "@/lib/naba-review-api"
import {
  readControlValue,
  Stars,
  StatusBadge,
  type View,
} from "@/components/naba-review/shared"

type Queue = "all" | ReviewStatus

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
      {activeView === "analytics" ? <AnalyticsView /> : null}
      {activeView === "connections" ? (
        <ConnectionsView onNavigate={() => navigate("settings")} />
      ) : null}
      {activeView === "settings" ? <SettingsView /> : null}
    </AppShell>
  )
}

function ReviewsWorkspace({
  reviews,
  setReviews,
  selectedId,
  setSelectedId,
  apiStatus,
  onRefresh,
}: {
  reviews: Review[]
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>
  selectedId: string
  setSelectedId: (id: string) => void
  apiStatus: "loading" | "connected" | "error"
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
  const deferredQuery = useDeferredValue(query)
  const locationDirectory = useMemo(
    () => mergeLocationDirectory(knownLocations, reviews),
    [knownLocations, reviews]
  )
  const selectedLocationId =
    location === "All locations" ? undefined : locationDirectory.get(location)

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
    if (apiStatus !== "connected") return
    const timeout = window.setTimeout(() => {
      startFiltering(async () => {
        try {
          const page = await loadReviewsPage(serverFilters)
          setKnownLocations((current) =>
            mergeLocationDirectory(current, page.items)
          )
          setReviews(page.items)
          setNextCursor(page.nextCursor)
          setSelectedId(page.items[0]?.id ?? "")
        } catch {
          // Preserve the last successful inbox state during a transient failure.
        }
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [apiStatus, serverFilters, setReviews, setSelectedId])

  const filteredReviews = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return reviews.filter((review) => {
      const matchesQueue =
        apiStatus === "connected" || queue === "all" || review.status === queue
      const matchesLocation =
        apiStatus === "connected" ||
        location === "All locations" ||
        review.location === location
      const matchesRating =
        apiStatus === "connected" ||
        rating === "all" ||
        review.rating === Number.parseInt(rating)
      const matchesQuery =
        apiStatus === "connected" ||
        !normalizedQuery ||
        `${review.reviewer} ${review.text} ${review.location}`
          .toLowerCase()
          .includes(normalizedQuery)
      return matchesQueue && matchesLocation && matchesRating && matchesQuery
    })
  }, [apiStatus, deferredQuery, location, queue, rating, reviews])

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
  }

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b px-4 py-5 md:px-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-medium tracking-tight">
              Reviews
            </h1>
            <p className="text-sm text-muted-foreground">
              Review, verify and publish Google responses.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw data-icon="inline-start" />
            {apiStatus === "connected"
              ? "Live data"
              : apiStatus === "loading"
                ? "Connecting"
                : "Retry live data"}
          </Button>
        </div>

        {apiStatus === "error" ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Live review data is unavailable</AlertTitle>
            <AlertDescription>
              NabaReview will not substitute preview records. Check the
              connection, then retry.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
          <div className="flex [scrollbar-width:none] gap-1 overflow-x-auto pb-1 2xl:pb-0 [&::-webkit-scrollbar]:hidden">
            {QUEUES.map((item) => {
              const count =
                item.id === "all"
                  ? reviews.length
                  : reviews.filter((review) => review.status === item.id).length
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQueue(item.id)}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                    queue === item.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  aria-pressed={queue === item.id}
                >
                  {item.label}
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              )
            })}
          </div>

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
            <Select
              value={location}
              onValueChange={(value) => {
                if (value) setLocation(value)
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {["All locations", ...locationDirectory.keys()].map(
                    (item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={dateRange}
              onValueChange={(value) => value && setDateRange(value)}
            >
              <SelectTrigger size="sm" aria-label="Filter by date range">
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
            <Select
              value={replyState}
              onValueChange={(value) => value && setReplyState(value)}
            >
              <SelectTrigger size="sm" aria-label="Filter by reply state">
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
            <Select
              value={verification}
              onValueChange={(value) => value && setVerification(value)}
            >
              <SelectTrigger size="sm" aria-label="Filter by verification">
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
            <Select
              value={publishState}
              onValueChange={(value) => value && setPublishState(value)}
            >
              <SelectTrigger size="sm" aria-label="Filter by publish status">
                <SelectValue>
                  {publishState === "all"
                    ? "Any publish status"
                    : publishState.replaceAll("_", " ")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Any publish status</SelectItem>
                  <SelectItem value="not_published">Not published</SelectItem>
                  <SelectItem value="awaiting_approval">
                    Awaiting approval
                  </SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={syncState}
              onValueChange={(value) => value && setSyncState(value)}
            >
              <SelectTrigger size="sm" aria-label="Filter by sync status">
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
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(340px,0.78fr)_minmax(520px,1.4fr)]">
        <section
          aria-label="Review list"
          className={cn(
            "min-h-0 border-r",
            mobilePane === "detail" ? "hidden lg:block" : "block"
          )}
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col">
              {filteredReviews.length ? (
                filteredReviews.map((review) => (
                  <ReviewRow
                    key={review.id}
                    review={review}
                    selected={review.id === selectedReview?.id}
                    onSelect={() => selectReview(review.id)}
                  />
                ))
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-8 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Search className="size-5" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">No reviews found</p>
                    <p className="text-xs text-muted-foreground">
                      Try changing your filters or search.
                    </p>
                  </div>
                </div>
              )}
              {apiStatus === "connected" && nextCursor ? (
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
            </div>
          </ScrollArea>
        </section>

        <section
          aria-label="Selected review"
          className={cn(
            "min-h-0",
            mobilePane === "list" ? "hidden lg:block" : "block"
          )}
        >
          <ScrollArea className="h-full">
            {selectedReview ? (
              <ReviewDetail
                key={selectedReview.id}
                review={selectedReview}
                onBack={() => setMobilePane("list")}
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
              <div className="flex min-h-96 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Connect Google and link a verified location to begin.
              </div>
            )}
          </ScrollArea>
        </section>
      </div>
    </div>
  )
}

function ReviewRow({
  review,
  selected,
  onSelect,
}: {
  review: Review
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 border-b px-4 py-4 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none focus-visible:ring-inset md:px-5",
        selected ? "bg-accent/70" : "hover:bg-muted/60"
      )}
      aria-current={selected ? "true" : undefined}
    >
      <Avatar className="size-9 shrink-0">
        <AvatarFallback>{review.initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{review.reviewer}</p>
            <p className="truncate text-xs text-muted-foreground">
              {review.location}
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {review.postedAt.split(",")[0]}
          </span>
        </div>
        <Stars value={review.rating} compact />
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {review.excerpt}
        </p>
        <StatusBadge status={review.status} />
      </div>
    </button>
  )
}

function ReviewDetail({
  review,
  onBack,
  onUpdate,
}: {
  review: Review
  onBack: () => void
  onUpdate: (patch: Partial<Review>) => void
}) {
  const [draft, setDraft] = useState(review.draft)
  const [feedback, setFeedback] = useState("")
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">(
    "success"
  )
  const [isPending, startTransition] = useTransition()
  const [detailState, setDetailState] = useState<{
    reviewId: string
    data: ReviewDetailData
  } | null>(null)
  const [detailError, setDetailError] = useState("")
  const detail = detailState?.reviewId === review.id ? detailState.data : null

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
        const generated = await generateDraft(review.id)
        setDraft(generated.body)
        onUpdate({
          draft: generated.body,
          draftId: generated.draftId,
          verification: generated.verification.verdict,
        })
        setFeedbackKind("success")
        setFeedback("A new verified draft is ready.")
      } catch (error) {
        setFeedbackKind("error")
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
        const saved = await saveDraftToApi(review.id, draft)
        onUpdate({
          draft: saved.body,
          draftId: saved.draftId,
          verification: saved.verification.verdict,
        })
        setFeedbackKind("success")
        setFeedback("Draft saved to the review audit trail.")
      } catch (error) {
        setFeedbackKind("error")
        setFeedback(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function publish() {
    setFeedback("")
    startTransition(async () => {
      try {
        const saved =
          !review.draftId || draft !== review.draft
            ? await saveDraftToApi(review.id, draft)
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
          responseTime: "Just now",
        })
        setFeedback(
          status === "awaiting_approval"
            ? "Reply submitted for approval."
            : "Reply sent to Google."
        )
        setFeedbackKind("success")
      } catch (error) {
        setFeedbackKind("error")
        setFeedback(error instanceof Error ? error.message : "Publish failed.")
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 md:px-7 md:py-7">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="lg:hidden"
          aria-label="Back to review list"
        >
          <ArrowLeft />
        </Button>
        <Avatar className="size-10">
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
            <DropdownMenuGroup>
              <DropdownMenuItem>Copy review ID</DropdownMenuItem>
              <DropdownMenuItem>Open audit trail</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive">
                Report an issue
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-xl border bg-muted/35 p-4 md:p-5">
        <p className="text-sm leading-7">{review.text}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Updated {review.updatedAt.toLowerCase()}</span>
          <span>·</span>
          <span>{review.language}</span>
        </div>
      </div>

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <WandSparkles className="size-4 text-primary" aria-hidden />
              <h3 className="text-sm font-medium">Reply draft</h3>
            </div>
            <Select defaultValue="warm">
              <SelectTrigger size="sm" aria-label="Reply tone">
                <SelectValue>Warm professional</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="warm">Warm professional</SelectItem>
                  <SelectItem value="concise">Concise</SelectItem>
                  <SelectItem value="empathetic">Empathetic</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Textarea
            key={review.id}
            value={draft}
            onChange={(event) => {
              setDraft(readControlValue(event))
              setFeedback("")
            }}
            rows={8}
            aria-label="Reply draft"
            className="min-h-44 resize-y text-sm leading-6"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {new TextEncoder().encode(draft).length} / 4096 bytes
            </span>
            <span className="text-[11px] text-muted-foreground">
              Original language: {review.language}
            </span>
          </div>

          {feedback ? (
            <p
              className={cn(
                "text-xs",
                feedbackKind === "error" ? "text-destructive" : "text-success"
              )}
              role="status"
              aria-live="polite"
            >
              {feedback}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              className="sm:ml-auto"
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
                : review.status === "awaiting_approval"
                  ? "Approve and publish"
                  : "Publish reply"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-5 border-t pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
          <VerificationPanel review={review} />
          <Separator />
          <ActivityTimeline events={detail?.timeline} error={detailError} />
        </div>
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
                <span className="text-[11px] text-muted-foreground">
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
