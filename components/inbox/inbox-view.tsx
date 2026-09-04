"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
} from "lucide-react"

import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { InboxRail } from "@/components/inbox/inbox-rail"
import { ReviewFilters } from "@/components/inbox/review-filters"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { QueryStates } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { applySavedView, savedView } from "@/lib/inbox/saved-views"
import { useClients } from "@/lib/queries/use-clients"
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
  type AdjacentDirection,
} from "@/lib/inbox/queue-nav"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"
import { cn } from "@/lib/utils"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

function InboxViewInner({
  showLocationFilter,
}: {
  showLocationFilter: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    // A saved view expands into filters, but anything the URL states
    // explicitly wins: an operator who opens a view and then narrows it by
    // rating meant the narrowing.
    return applySavedView(parseInboxState(params), params)
  }, [searchParams])
  const filters = useMemo(() => toReviewsFilters(state), [state])
  const dirtyGate = useDirtyGate()
  const readIsDirty = useReadIsDirty()

  const reviewsQuery = useReviews(filters)
  const countsQuery = useReviewCounts({ groupBy: "client" })
  const clientsQuery = useClients()
  const selection = useSelection()
  const [railOpen, setRailOpen] = useState(false)
  const health = useConnectionHealth()
  // Via the shared directory hook, not a bare useQuery on the same key: this
  // view and LocationsIndex share one QueryClient across client navigation,
  // and writing the raw `{locations: […]}` envelope here while the hook writes
  // a mapped array meant whichever mounted last corrupted the other.
  const locationsQuery = useLocationDirectory(useSessionRole())

  const reviews = flattenReviews(reviewsQuery.data)

  // No page state: the list loads continuously. The seven-per-page control
  // over a fifty-row window meant "Page 3 of 8" was only ever true of the rows
  // already fetched, and an operator working a backlog spent as much time
  // paging as replying.
  const loadMore = useCallback(() => {
    if (reviewsQuery.hasNextPage && !reviewsQuery.isFetchingNextPage) {
      void reviewsQuery.fetchNextPage()
    }
  }, [reviewsQuery])

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
        // Choosing a queue under "Everything" clears the client scope — the
        // heading says everything, so it has to mean it.
        updateState(
          { queue, clientId: undefined, selected: undefined, view: undefined },
          "replace"
        )
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
  const onSelectView = useCallback(
    (slug: string) => {
      void (async () => {
        if (!(await dirtyGate())) return
        // A view REPLACES the filter set rather than layering on top: half of
        // the previous view's filters silently surviving is how an operator
        // ends up staring at an empty list they cannot explain.
        const view = savedView(slug)
        if (!view) return
        router.replace(
          `/inbox?${serializeInboxState({
            queue: view.state.queue ?? "needs_reply",
            locationIds: [],
            ratings: [],
            search: "",
            sort: "updated_desc",
            verification: [],
            publishStatus: [],
            syncStatus: [],
            ...view.state,
            view: slug,
          } as InboxState).toString()}`
        )
      })()
    },
    [dirtyGate, router]
  )
  const onSelectClientQueue = useCallback(
    (clientId: string, queue: Queue) => {
      void (async () => {
        if (!(await dirtyGate())) return
        updateState(
          { clientId, queue, selected: undefined, view: undefined },
          "replace"
        )
      })()
    },
    [dirtyGate, updateState]
  )
  const onClearFilters = useCallback(() => {
    void (async () => {
      if (!(await dirtyGate())) return
      router.replace(
        `/inbox?${serializeInboxState({
          queue: state.queue,
          locationIds: [],
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
          updateState({ selected: firstNew.id }, "push")
          return true
        }
      }
      return false
    },
    [dirtyGate, reviews, reviewsQuery, state.selected, updateState]
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
  const selectReviewRef = useRef((id: string) => {
    updateState({ selected: id }, "push")
  })
  useEffect(() => {
    onAdjacentReviewRef.current = onAdjacentReview
    selectedRef.current = state.selected
    reviewsRef.current = reviews
    selectReviewRef.current = (id: string) => {
      updateState({ selected: id }, "push")
    }
  }, [onAdjacentReview, reviews, state.selected, updateState])
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
          selectReviewRef.current(target)
          return
        }
        const shifted = index >= 0 ? current[index] : undefined
        if (shifted && shifted.id !== reviewId) {
          selectReviewRef.current(shifted.id)
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
    return (
      <ReviewList
        reviews={reviews}
        selectedId={state.selected}
        onSelect={onSelect}
        onMovePastEnd={(direction) => {
          void onAdjacentReview(direction)
        }}
        isRefreshing={isListRefreshing}
        onReachEnd={loadMore}
        isLoadingMore={reviewsQuery.isFetchingNextPage}
        selection={{
          selected: selection.selected,
          toggle: (id) => selection.toggle(id),
          extendTo: (id) => selection.extendTo(id, reviews.map((r) => r.id)),
        }}
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

  // `r` and `a` are handled by the detail pane's own controls, which know
  // whether they are currently allowed; the hotkey layer only moves focus
  // there. Firing a publish from here would bypass every gate the action bar
  // applies.
  const hotkeyHandlers = useMemo(
    () => ({
      next: () => void onAdjacentReview("next"),
      previous: () => void onAdjacentReview("prev"),
      "toggle-selection": () => {
        if (state.selected) selection.toggle(state.selected)
      },
      "extend-selection": () => {
        if (state.selected)
          selection.extendTo(state.selected, reviews.map((review) => review.id))
      },
      "clear-selection": () => selection.clear(),
    }),
    [onAdjacentReview, reviews, selection, state.selected]
  )

  const rail = (
    <InboxRail
      state={state}
      counts={countsQuery.data}
      countsPending={countsQuery.isPending}
      clients={(clientsQuery.data?.items ?? []).map((client) => ({
        id: client.id,
        name: client.name,
        health: client.health,
      }))}
      onQueueChange={onQueueChange}
      onSelectView={onSelectView}
      onSelectClientQueue={onSelectClientQueue}
    />
  )

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[232px_minmax(340px,0.9fr)_minmax(0,1.5fr)]">
      <InboxHotkeys handlers={hotkeyHandlers} />
      {/* The rail is desktop-only furniture; below lg it opens as a sheet from
          the list header, because three panes on a phone is none of them. */}
      <div
        className={cn(
          "min-h-0 overflow-hidden rounded-(--np-radius-card) border border-line bg-surface",
          "hidden lg:flex lg:flex-col"
        )}
      >
        {rail}
      </div>
      {/* Queue pane: solid card (design-system hierarchy: lists stay solid,
          not glass), shadow elevates it off the tinted page background. */}
      <div
        className={cn(
          "min-h-0 flex-col overflow-hidden rounded-(--nr-radius-card) border border-border bg-card shadow-(--nr-shadow-card)",
          mobilePane === "detail" ? "hidden lg:flex" : "flex"
        )}
      >
        <div className="flex flex-col gap-2 border-b border-line-subtle px-3 py-3">
          <div className="flex items-center gap-2 lg:hidden">
            <Sheet open={railOpen} onOpenChange={setRailOpen}>
              <SheetTrigger
                render={<Button variant="outline" size="sm" />}
              >
                Queues
              </SheetTrigger>
              <SheetContent side="left" className="data-[side=left]:w-80">
                <SheetHeader className="sr-only">
                  <SheetTitle>Review queues</SheetTitle>
                  <SheetDescription>
                    Filter the inbox by queue, client or saved view.
                  </SheetDescription>
                </SheetHeader>
                <div onClick={() => setRailOpen(false)}>{rail}</div>
              </SheetContent>
            </Sheet>
          </div>
          <ReviewFilters
            state={state}
            locations={locationsQuery.data ?? []}
            showLocationFilter={showLocationFilter}
            onChange={onFilterChange}
            onClear={onClearFilters}
          />
        </div>
        {renderList()}
        {!reviewsQuery.isPending && !reviewsQuery.isError && reviews.length > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-4 py-2">
            {/* Announced politely rather than as a page number, because the
                count changes as rows load rather than jumping between pages. */}
            <span
              aria-live="polite"
              className="text-caption text-ink-muted tabular-nums"
            >
              Showing {reviews.length}
              {reviewsQuery.hasNextPage ? " so far" : ""}
            </span>
            {reviewsQuery.hasNextPage ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={reviewsQuery.isFetchingNextPage}
                onClick={loadMore}
              >
                {reviewsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        ) : null}
        <BulkActionBar rows={reviews} />
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
      <SelectionProvider>
        <InboxViewInner showLocationFilter={showLocationFilter} />
      </SelectionProvider>
    </DirtyGuardProvider>
  )
}

export { InboxView }
