"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
} from "lucide-react"

import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewFilters } from "@/components/inbox/review-filters"
import { ReviewList } from "@/components/inbox/review-list"
import { EmptyState } from "@/components/inbox/empty-states"
import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import { ReviewDetail } from "@/components/inbox/review-detail"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import { ActionBar } from "@/components/inbox/action-bar"
import {
  DirtyGuardProvider,
  useDirtyGate,
  useReadIsDirty,
} from "@/components/inbox/dirty-context"
import { Button } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import {
  autoSelectId,
  DESKTOP_MEDIA_QUERY,
  hasActiveFilters,
  mobilePaneFor,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import {
  adjacentReviewId,
  pageForIndex,
  type AdjacentDirection,
} from "@/lib/inbox/queue-nav"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"
import { cn } from "@/lib/utils"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

// Page-based pagination over the loaded rows: 7 per page, Prev/Next controls.
// The API is cursor-based, so "next page" past the loaded rows triggers one
// fetchNextPage per click; already-loaded pages page locally.
const PAGE_SIZE = 7

function InboxViewInner({
  showLocationFilter,
}: {
  showLocationFilter: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = useMemo(
    () => parseInboxState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )
  const filters = useMemo(() => toReviewsFilters(state), [state])
  const dirtyGate = useDirtyGate()
  const readIsDirty = useReadIsDirty()

  const reviewsQuery = useReviews(filters)
  const countsQuery = useReviewCounts(state.locationId)
  const health = useConnectionHealth()
  // Via the shared directory hook, not a bare useQuery on the same key: this
  // view and LocationsIndex share one QueryClient across client navigation,
  // and writing the raw `{locations: […]}` envelope here while the hook writes
  // a mapped array meant whichever mounted last corrupted the other.
  const locationsQuery = useLocationDirectory(useSessionRole())

  const reviews = flattenReviews(reviewsQuery.data)

  // Current page (0-based). Resets when the filter content changes
  // (stringified — `filters` object identity also changes on selection, which
  // must NOT bounce the user back to page 1).
  const [page, setPage] = useState(0)
  const filtersKey = JSON.stringify(filters)
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey)
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey)
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(reviews.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageReviews = reviews.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE
  )
  const hasPrevPage = currentPage > 0
  const hasNextPage = currentPage < pageCount - 1 || !!reviewsQuery.hasNextPage

  const onPrevPage = useCallback(() => {
    setPage((p) => Math.max(0, p - 1))
  }, [setPage])
  const onNextPage = useCallback(() => {
    const next = currentPage + 1
    // Crossing into rows the client doesn't have yet: fetch the API's next
    // cursor page (one page of 50 covers ~7 UI pages, so this is rare).
    if (
      next * PAGE_SIZE >= reviews.length &&
      reviewsQuery.hasNextPage &&
      !reviewsQuery.isFetchingNextPage
    ) {
      void reviewsQuery.fetchNextPage()
    }
    setPage(next)
  }, [currentPage, reviews.length, reviewsQuery, setPage])

  const updateState = useCallback(
    (partial: Partial<InboxState>, mode: "replace" | "push") => {
      const next = serializeInboxState({ ...state, ...partial })
      const query = next.toString()
      const href = query ? `/inbox?${query}` : "/inbox"
      if (mode === "push") router.push(href)
      else router.replace(href)
    },
    [router, state]
  )

  // Filters use replace (no history spam) and drop any stale selection. Every
  // handler below drops `selected` (explicitly or by omitting it from the
  // next state), which would silently unmount a dirty composer — gated behind
  // the same dirty guard as `onSelect` so an in-progress edit prompts a
  // discard confirm instead of vanishing.
  const onFilterChange = useCallback(
    (partial: Partial<InboxState>) => {
      void (async () => {
        if (!(await dirtyGate())) return
        updateState({ ...partial, selected: undefined }, "replace")
      })()
    },
    [dirtyGate, updateState]
  )
  const onQueueChange = useCallback(
    (queue: Queue) => {
      void (async () => {
        if (!(await dirtyGate())) return
        updateState({ queue, selected: undefined }, "replace")
      })()
    },
    [dirtyGate, updateState]
  )
  // Selection uses push so Back returns to the list on mobile (spec §6). Gated
  // behind the dirty guard: while the composer is dirty this either confirms
  // discarding the edit (AlertDialog) or blocks the selection change. The
  // boolean return tells ReviewList's arrow-key handler whether it's safe to
  // move DOM focus onto the target row (see review-list.tsx).
  const onSelect = useCallback(
    async (id: string): Promise<boolean> => {
      if (!(await dirtyGate())) return false
      updateState({ selected: id }, "push")
      return true
    },
    [dirtyGate, updateState]
  )
  const onClearFilters = useCallback(() => {
    void (async () => {
      if (!(await dirtyGate())) return
      router.replace(
        `/inbox?${serializeInboxState({
          queue: state.queue,
          ratings: [],
          search: "",
          sort: "updated_desc",
          verification: [],
          publishStatus: [],
          syncStatus: [],
        }).toString()}`
      )
    })()
  }, [dirtyGate, router, state.queue])
  // Same gate as the handlers above: returning to the list also drops
  // `selected`, which would otherwise silently unmount a dirty composer.
  const onBackToList = useCallback(() => {
    void (async () => {
      if (!(await dirtyGate())) return
      updateState({ selected: undefined }, "replace")
    })()
  }, [dirtyGate, updateState])

  const selectedIndex = state.selected
    ? reviews.findIndex((review) => review.id === state.selected)
    : -1
  const hasPrevReview = selectedIndex > 0
  const hasNextReview =
    selectedIndex >= 0 &&
    (selectedIndex < reviews.length - 1 || !!reviewsQuery.hasNextPage)

  const onAdjacentReview = useCallback(
    async (direction: AdjacentDirection) => {
      if (!(await dirtyGate())) return false
      const nextId = adjacentReviewId(reviews, state.selected, direction)
      if (nextId) {
        const index = reviews.findIndex((review) => review.id === nextId)
        setPage(pageForIndex(index, PAGE_SIZE))
        updateState({ selected: nextId }, "push")
        return true
      }
      if (
        direction === "next" &&
        reviewsQuery.hasNextPage &&
        !reviewsQuery.isFetchingNextPage
      ) {
        const result = await reviewsQuery.fetchNextPage()
        const newItems = result.data?.pages.at(-1)?.items ?? []
        const firstNew = newItems[0]
        if (firstNew) {
          setPage(pageForIndex(reviews.length, PAGE_SIZE))
          updateState({ selected: firstNew.id }, "push")
          return true
        }
      }
      return false
    },
    [dirtyGate, reviews, reviewsQuery, setPage, state.selected, updateState]
  )

  // Spec §6 auto-selection: on desktop, when the URL carries no selection, pick
  // the first row (replace, so it adds no history). Reads live dirtiness
  // imperatively via `useReadIsDirty()` for the (rare) cleared-while-dirty edge.
  const reviewsReady = !reviewsQuery.isPending && !reviewsQuery.isError
  useEffect(() => {
    if (!reviewsReady) return
    const id = autoSelectId({
      selected: state.selected,
      reviews,
      isDirty: readIsDirty(),
      isDesktop:
        typeof window !== "undefined" &&
        window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    })
    if (id) {
      router.replace(
        `/inbox?${serializeInboxState({ ...state, selected: id }).toString()}`
      )
    }
  }, [reviewsReady, reviews, state, router, readIsDirty])

  // After a successful publish, move to the next review so the 674-item
  // backlog is a loop rather than "Back to reviews" + another click. The move
  // waits PUBLISH_PULSE_MS so the situation strip's success ring (which lives
  // in the detail pane keyed on `state.selected`, and so unmounts on
  // navigation) is actually seen. The latest handler and selection are read
  // through refs so the window listener subscribes once, not on every render
  // (`onAdjacentReview` follows `reviewsQuery`, which is a new object each
  // render).
  const onAdjacentReviewRef = useRef(onAdjacentReview)
  const selectedRef = useRef(state.selected)
  const reviewsRef = useRef(reviews)
  const selectReviewRef = useRef((id: string, index: number) => {
    setPage(pageForIndex(index, PAGE_SIZE))
    updateState({ selected: id }, "push")
  })
  useEffect(() => {
    onAdjacentReviewRef.current = onAdjacentReview
    selectedRef.current = state.selected
    reviewsRef.current = reviews
    selectReviewRef.current = (id: string, index: number) => {
      setPage(pageForIndex(index, PAGE_SIZE))
      updateState({ selected: id }, "push")
    }
  }, [onAdjacentReview, reviews, setPage, state.selected, updateState])
  useEffect(() => {
    let timer: number | undefined
    function onPublished(event: Event) {
      const reviewId = (event as CustomEvent<{ reviewId?: string }>).detail
        ?.reviewId
      if (!reviewId || reviewId !== selectedRef.current) return
      // Decide the target NOW: the publish mutation invalidates the list, and
      // in the Needs reply queue the refetch drops the just-published review
      // out of it well inside the pulse, after which "next of the selected
      // review" no longer resolves. Fall back to whatever row now sits at the
      // same index (the list shifted up), then to the next API page.
      const loaded = reviewsRef.current
      const index = loaded.findIndex((review) => review.id === reviewId)
      const target = adjacentReviewId(loaded, reviewId, "next")
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        // The operator moved on during the pulse — do not yank them again.
        if (selectedRef.current !== reviewId) return
        const current = reviewsRef.current
        const stillThere =
          target && current.some((review) => review.id === target)
        if (stillThere) {
          selectReviewRef.current(
            target,
            current.findIndex((review) => review.id === target)
          )
          return
        }
        const shifted = index >= 0 ? current[index] : undefined
        if (shifted && shifted.id !== reviewId) {
          selectReviewRef.current(shifted.id, index)
          return
        }
        void onAdjacentReviewRef.current("next")
      }, PUBLISH_PULSE_MS)
    }
    window.addEventListener(PUBLISH_PULSE_EVENT, onPublished)
    return () => {
      window.removeEventListener(PUBLISH_PULSE_EVENT, onPublished)
      window.clearTimeout(timer)
    }
  }, [])

  const isListRefreshing =
    reviewsQuery.isFetching &&
    !reviewsQuery.isPending &&
    !reviewsQuery.isFetchingNextPage

  // After Next past already-loaded rows, the page index advances before the
  // cursor fetch lands — keep skeletons instead of flashing an empty list.
  const waitingForPageRows =
    !reviewsQuery.isPending &&
    !reviewsQuery.isError &&
    reviews.length > 0 &&
    pageReviews.length === 0 &&
    (reviewsQuery.isFetchingNextPage || !!reviewsQuery.hasNextPage)

  function renderListSkeleton() {
    return (
      <div aria-busy="true" className="flex flex-col">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className="flex items-start gap-3 border-b border-border/40 px-4 py-3"
          >
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-28 rounded-(--nr-radius-tag)" />
              <Skeleton className="h-3 w-40 rounded-(--nr-radius-tag)" />
              <Skeleton className="h-3 w-full max-w-56 rounded-(--nr-radius-tag)" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  function renderList() {
    // A failed fetch is NOT "no reviews yet" (the empty-state copy for a
    // genuinely empty queue) -- that would silently mask a real error with no
    // way to retry. QueryStates renders the retry alert; the queue-specific
    // empty states stay in renderLoadedList.
    return (
      <QueryStates
        status={
          reviewsQuery.isPending
            ? "pending"
            : reviewsQuery.isError
              ? "error"
              : "ready"
        }
        pending={renderListSkeleton()}
        error={{
          title: "We could not load your reviews.",
          cause: reviewsQuery.error,
          className: "p-6",
        }}
        onRetry={() => void reviewsQuery.refetch()}
      >
        {renderLoadedList}
      </QueryStates>
    )
  }

  function renderLoadedList() {
    if (reviews.length === 0) {
      const total = countsQuery.data?.total ?? 0
      const kind =
        health.status === "disconnected"
          ? "disconnected"
          : hasActiveFilters(state) || total > 0
            ? "filtered"
            : "no-data"
      return (
        <div className="p-6">
          <EmptyState kind={kind} onClear={onClearFilters} />
        </div>
      )
    }
    if (waitingForPageRows) {
      return renderListSkeleton()
    }
    return (
      <ReviewList
        reviews={pageReviews}
        selectedId={state.selected}
        onSelect={onSelect}
        onMovePastEnd={(direction) => {
          void onAdjacentReview(direction)
        }}
        isRefreshing={isListRefreshing}
      />
    )
  }

  // Below lg, show one pane: the list, or the detail when a review is selected
  // (spec §6). At lg both panes are always visible (two-pane split).
  const mobilePane = mobilePaneFor(state.selected)

  // Below lg, selecting a review swaps the visible pane from the list to the
  // detail view — move focus to the pane's own "Back to reviews" control so
  // keyboard/screen-reader users land somewhere meaningful in the new pane
  // instead of losing their place (mirrors the same button re-focusing the
  // originating row on the way back, below). `.focus()` on the `lg:hidden`
  // button is a silent no-op at the lg breakpoint (it is `display: none`
  // there), so this is harmless on desktop.
  const backButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (state.selected) backButtonRef.current?.focus()
  }, [state.selected])

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
      {/* Queue pane: solid card (design-system hierarchy: lists stay solid,
          not glass), shadow elevates it off the tinted page background. */}
      <div
        className={cn(
          "min-h-0 flex-col overflow-hidden rounded-(--nr-radius-card) border border-border bg-card shadow-(--nr-shadow-card)",
          mobilePane === "detail" ? "hidden lg:flex" : "flex"
        )}
      >
        <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/40 px-3 py-3">
          <QueueTabs
            queue={state.queue}
            total={countsQuery.data?.total ?? 0}
            byStatus={countsQuery.data?.byStatus ?? {}}
            countsPending={countsQuery.isPending}
            onQueueChange={onQueueChange}
          />
          <ReviewFilters
            state={state}
            locations={locationsQuery.data ?? []}
            showLocationFilter={showLocationFilter}
            onChange={onFilterChange}
            onClear={onClearFilters}
          />
        </div>
        {renderList()}
        {!reviewsQuery.isPending &&
        !reviewsQuery.isError &&
        reviews.length > 0 ? (
          <nav
            aria-label="Review pages"
            className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5"
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPrevPage}
              onClick={onPrevPage}
            >
              <ChevronLeftIcon aria-hidden />
              Previous
            </Button>
            <span className="text-caption text-muted-foreground tabular-nums">
              Page {currentPage + 1}
              {reviewsQuery.hasNextPage
                ? " · more available"
                : ` of ${pageCount}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasNextPage || reviewsQuery.isFetchingNextPage}
              onClick={onNextPage}
            >
              {reviewsQuery.isFetchingNextPage ? "Loading…" : "Next"}
              <ChevronRightIcon aria-hidden />
            </Button>
          </nav>
        ) : null}
      </div>

      <section
        aria-label="Selected review"
        className={cn(
          "min-h-0 rounded-(--nr-radius-card) border border-border bg-card shadow-(--nr-shadow-card) lg:flex lg:flex-col",
          mobilePane === "detail" ? "flex flex-col" : "hidden lg:flex"
        )}
      >
        {state.selected ? (
          <DetailErrorBoundary key={state.selected}>
            <div
              key={state.selected}
              className="flex min-h-0 flex-1 animate-in flex-col duration-(--nr-duration-fast) fade-in-0"
            >
              <ReviewDetail
                reviewId={state.selected}
                leading={
                  // Mobile-only return-to-list affordance, pinned in the pane
                  // header; Back also works because selection was pushed
                  // (spec §6).
                  <Button
                    ref={backButtonRef}
                    variant="ghost"
                    size="sm"
                    onClick={onBackToList}
                    className="-ml-2 lg:hidden"
                  >
                    <ArrowLeftIcon aria-hidden />
                    Back to reviews
                  </Button>
                }
                navigation={
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Previous review"
                      disabled={!hasPrevReview}
                      onClick={() => void onAdjacentReview("prev")}
                    >
                      <ChevronLeftIcon aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Next review"
                      disabled={
                        !hasNextReview || reviewsQuery.isFetchingNextPage
                      }
                      onClick={() => void onAdjacentReview("next")}
                    >
                      <ChevronRightIcon aria-hidden />
                    </Button>
                  </div>
                }
                composer={<ReplyComposer reviewId={state.selected} />}
                actions={<ActionBar reviewId={state.selected} />}
              />
            </div>
          </DetailErrorBoundary>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MessagesSquareIcon aria-hidden className="size-5" />
            </span>
            <p className="text-ui text-muted-foreground">
              Select a review to see the full conversation.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

// `showLocationFilter` is resolved on the server (app/(dashboard)/inbox/page.tsx)
// rather than from the fetched location list, because the list is empty on the
// first paint: a client-side length check would either flash the control in
// for multi-location orgs or — worse — flash it out from under a single-location
// user who was already reaching for it. Defaults to true so every existing
// caller and test keeps a visible filter; a redundant control is a much better
// failure mode than a silently missing one.
function InboxView({
  showLocationFilter = true,
}: {
  showLocationFilter?: boolean
}) {
  return (
    <DirtyGuardProvider>
      <InboxViewInner showLocationFilter={showLocationFilter} />
    </DirtyGuardProvider>
  )
}

export { InboxView }
