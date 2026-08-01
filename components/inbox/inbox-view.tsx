"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo } from "react"

import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewFilters } from "@/components/inbox/review-filters"
import { ReviewList } from "@/components/inbox/review-list"
import { EmptyState } from "@/components/inbox/empty-states"
import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import { ReviewDetail } from "@/components/inbox/review-detail"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import {
  DirtyGuardProvider,
  useDirtyGate,
  useReadIsDirty,
} from "@/components/inbox/dirty-context"
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
  // discarding the edit (window.confirm) or blocks the selection change.
  const onSelect = useCallback(
    (id: string) => {
      if (!dirtyGate()) return
      updateState({ selected: id }, "push")
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
      return (
        <div className="p-6">
          <EmptyState kind="no-data" />
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
      <ReviewList reviews={reviews} selectedId={state.selected} onSelect={onSelect} />
    )
  }

  // Below xl, show one pane: the list, or the detail when a review is selected
  // (spec §6). At xl both panes are always visible (two-pane split).
  const mobilePane = mobilePaneFor(state.selected)

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
      <div
        className={cn(
          "min-h-0 flex-col gap-3 overflow-hidden rounded-(--nr-radius-card) border border-border bg-card",
          mobilePane === "detail" ? "hidden xl:flex" : "flex"
        )}
      >
        <div className="flex flex-col gap-3 border-b border-border/60 p-4">
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
        {reviewsQuery.hasNextPage ? (
          <div className="border-t border-border/60 p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={reviewsQuery.isFetchingNextPage}
              onClick={() => void reviewsQuery.fetchNextPage()}
            >
              {reviewsQuery.isFetchingNextPage ? "Loading…" : "Load more reviews"}
            </Button>
          </div>
        ) : null}
      </div>

      <section
        aria-label="Selected review"
        className={cn(
          "min-h-0 rounded-(--nr-radius-card) border border-border bg-card xl:flex xl:flex-col",
          mobilePane === "detail" ? "flex flex-col" : "hidden xl:flex"
        )}
      >
        {state.selected ? (
          <>
            {/* Mobile-only return-to-list affordance; Back also works because
                selection was pushed (spec §6). */}
            <div className="border-b border-border/60 p-3 xl:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBackToList}
              >
                Back to reviews
              </Button>
            </div>
            <DetailErrorBoundary key={state.selected}>
              <ReviewDetail
                reviewId={state.selected}
                footer={<ReplyComposer reviewId={state.selected} />}
              />
            </DetailErrorBoundary>
          </>
        ) : (
          <p className="p-6 text-ui text-muted-foreground">
            Select a review to see the full conversation.
          </p>
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
