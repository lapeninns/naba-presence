"use client"

import { useQuery } from "@tanstack/react-query"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchLocations } from "@/lib/api/locations"
import {
  autoSelectId,
  hasActiveFilters,
  mobilePaneFor,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/queries/keys"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

// Page-based pagination over the loaded rows: 7 per page, Prev/Next controls.
// The API is cursor-based, so "next page" past the loaded rows triggers one
// fetchNextPage per click; already-loaded pages page locally.
const PAGE_SIZE = 7

function InboxViewInner() {
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
  const locationsQuery = useQuery({
    queryKey: queryKeys.locations,
    queryFn: fetchLocations,
    staleTime: 30_000,
  })

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
  }, [])
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
  }, [currentPage, reviews.length, reviewsQuery])

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
      if (!dirtyGate()) return
      updateState({ ...partial, selected: undefined }, "replace")
    },
    [dirtyGate, updateState]
  )
  const onQueueChange = useCallback(
    (queue: Queue) => {
      if (!dirtyGate()) return
      updateState({ queue, selected: undefined }, "replace")
    },
    [dirtyGate, updateState]
  )
  // Selection uses push so Back returns to the list on mobile (spec §6). Gated
  // behind the dirty guard: while the composer is dirty this either confirms
  // discarding the edit (window.confirm) or blocks the selection change. The
  // boolean return tells ReviewList's arrow-key handler whether it's safe to
  // move DOM focus onto the target row (see review-list.tsx).
  const onSelect = useCallback(
    (id: string): boolean => {
      if (!dirtyGate()) return false
      updateState({ selected: id }, "push")
      return true
    },
    [dirtyGate, updateState]
  )
  const onClearFilters = useCallback(() => {
    if (!dirtyGate()) return
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
  }, [dirtyGate, router, state.queue])
  // Same gate as the handlers above: returning to the list also drops
  // `selected`, which would otherwise silently unmount a dirty composer.
  const onBackToList = useCallback(() => {
    if (!dirtyGate()) return
    updateState({ selected: undefined }, "replace")
  }, [dirtyGate, updateState])

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
        window.matchMedia("(min-width: 1280px)").matches,
    })
    if (id) {
      router.replace(
        `/inbox?${serializeInboxState({ ...state, selected: id }).toString()}`
      )
    }
  }, [reviewsReady, reviews, state, router, readIsDirty])

  function renderList() {
    if (reviewsQuery.isPending) {
      return (
        <div aria-busy="true" className="flex flex-col">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="mx-4 my-3 h-16 rounded-(--nr-radius-card)" />
          ))}
        </div>
      )
    }
    if (reviewsQuery.isError) {
      // A failed fetch is NOT "no reviews yet" (the empty-state copy for a
      // genuinely empty queue) -- that would silently mask a real error with
      // no way to retry. Mirrors ReviewDetail's error branch.
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>We could not load your reviews.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>Check your connection, then try again.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reviewsQuery.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
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
    return (
      <ReviewList
        reviews={pageReviews}
        selectedId={state.selected}
        onSelect={onSelect}
      />
    )
  }

  // Below xl, show one pane: the list, or the detail when a review is selected
  // (spec §6). At xl both panes are always visible (two-pane split).
  const mobilePane = mobilePaneFor(state.selected)

  // Below xl, selecting a review swaps the visible pane from the list to the
  // detail view — move focus to the pane's own "Back to reviews" control so
  // keyboard/screen-reader users land somewhere meaningful in the new pane
  // instead of losing their place (mirrors the same button re-focusing the
  // originating row on the way back, below). `.focus()` on the `xl:hidden`
  // wrapper's button is a silent no-op at the xl breakpoint (its ancestor is
  // `display: none` there), so this is harmless on desktop.
  const backButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (state.selected) backButtonRef.current?.focus()
  }, [state.selected])

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
      {/* Queue pane: solid card (design-system hierarchy: lists stay solid,
          not glass), shadow elevates it off the tinted page background. */}
      <div
        className={cn(
          "min-h-0 flex-col overflow-hidden rounded-(--nr-radius-card) border border-border bg-card shadow-(--nr-shadow-card)",
          mobilePane === "detail" ? "hidden xl:flex" : "flex"
        )}
      >
        <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/40 p-4">
          <QueueTabs
            queue={state.queue}
            total={countsQuery.data?.total ?? 0}
            byStatus={countsQuery.data?.byStatus ?? {}}
            onQueueChange={onQueueChange}
          />
          <ReviewFilters
            state={state}
            locations={locationsQuery.data?.locations ?? []}
            onChange={onFilterChange}
            onClear={onClearFilters}
          />
        </div>
        {renderList()}
        {!reviewsQuery.isPending && !reviewsQuery.isError && reviews.length > 0 ? (
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
              {reviewsQuery.hasNextPage ? "" : ` of ${pageCount}`}
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
          "min-h-0 rounded-(--nr-radius-card) border border-border bg-card shadow-(--nr-shadow-card) xl:flex xl:flex-col",
          mobilePane === "detail" ? "flex flex-col" : "hidden xl:flex"
        )}
      >
        {state.selected ? (
          <>
            {/* Mobile-only return-to-list affordance; Back also works because
                selection was pushed (spec §6). */}
            <div className="border-b border-border/60 p-2 xl:hidden">
              <Button
                ref={backButtonRef}
                variant="ghost"
                size="sm"
                onClick={onBackToList}
              >
                <ArrowLeftIcon aria-hidden />
                Back to reviews
              </Button>
            </div>
            <DetailErrorBoundary key={state.selected}>
              <ReviewDetail
                reviewId={state.selected}
                footer={
                  <div className="flex flex-col gap-4">
                    <ReplyComposer reviewId={state.selected} />
                    <ActionBar reviewId={state.selected} />
                  </div>
                }
              />
            </DetailErrorBoundary>
          </>
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

function InboxView() {
  return (
    <DirtyGuardProvider>
      <InboxViewInner />
    </DirtyGuardProvider>
  )
}

export { InboxView }
