"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
} from "lucide-react"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewSearchBar } from "@/components/inbox/review-filters"
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
import { useDesktopLayout } from "@/components/inbox/use-desktop-layout"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { QueryStates } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SplitPane,
  SplitPaneHandle,
  SplitPanePanel,
} from "@/components/ui/split-pane"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { emptyCounts, emptyReason } from "@/lib/inbox/empty-reason"
import { useClients } from "@/lib/queries/use-clients"
import {
  autoSelectId,
  DESKTOP_MEDIA_QUERY,
  hasActiveFilters,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import { adjacentReviewId, type AdjacentDirection } from "@/lib/inbox/queue-nav"
import {
  PUBLISH_PULSE_EVENT,
  PUBLISH_PULSE_MS,
  REPLY_FOCUS_EVENT,
} from "@/lib/inbox/events"
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
    return parseInboxState(new URLSearchParams(searchParams.toString()))
  }, [searchParams])
  const filters = useMemo(() => toReviewsFilters(state), [state])
  const dirtyGate = useDirtyGate()
  const readIsDirty = useReadIsDirty()

  const reviewsQuery = useReviews(filters)
  const countsQuery = useReviewCounts({ groupBy: "client" })
  const clientsQuery = useClients()
  // Narrowed to the client in view when the inbox is filtered to one, so the
  // empty state describes the client the operator is looking at rather than
  // the whole agency.
  const scopedClients = (clientsQuery.data?.items ?? []).filter(
    (client) => !state.clientId || client.id === state.clientId
  )
  const selection = useSelection()
  const health = useConnectionHealth()
  // Via the shared directory hook, not a bare useQuery on the same key: this
  // view and LocationsIndex share one QueryClient across client navigation,
  // and writing the raw `{locations: […]}` envelope here while the hook writes
  // a mapped array meant whichever mounted last corrupted the other.
  const locationsQuery = useLocationDirectory(useSessionRole())
  const isDesktop = useDesktopLayout()

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
          { queue, clientId: undefined, selected: undefined },
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
  // `keepPreviousData` keeps the OLD queue's rows on screen while the new
  // one loads. Auto-selecting from them re-adds a `selected` id that does not
  // belong to the queue the operator just chose — it reappeared in the URL
  // moments after the handler cleared it, and the pane showed a review the
  // list no longer contained.
  const reviewsReady =
    !reviewsQuery.isPending &&
    !reviewsQuery.isError &&
    !reviewsQuery.isPlaceholderData
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

  // The same four lines a real row draws: a name and a date, a venue and a
  // rating, one line of review, and the status.
  function renderListSkeleton() {
    return (
      <div aria-busy="true" className="flex flex-col">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="flex flex-col gap-2 border-b border-line-subtle px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-3 w-full max-w-64" />
            <div className="flex justify-end">
              <Skeleton className="h-3 w-20" />
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
          className: "p-(--np-card-pad)",
        }}
        onRetry={() => void reviewsQuery.refetch()}
      >
        {renderLoadedList}
      </QueryStates>
    )
  }

  function renderLoadedList() {
    if (reviews.length === 0) {
      // The clients this view already has in cache carry the import facts, so
      // the empty state can name which of the reasons it is instead of
      // guessing the reassuring one.
      const facts = {
        hasActiveFilters: hasActiveFilters(state),
        queue: state.queue,
        totalOutsideFilters: countsQuery.data?.total ?? 0,
        connection:
          health.status === "disconnected"
            ? ("disconnected" as const)
            : health.status === "connected"
              ? ("connected" as const)
              : ("unknown" as const),
        clients: scopedClients,
      }
      return (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <EmptyState
            reason={emptyReason(facts)}
            counts={emptyCounts(facts)}
            onClear={onClearFilters}
          />
        </div>
      )
    }
    return (
      <ReviewList
        reviews={reviews}
        selectedId={state.selected}
        queue={state.queue}
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
          extendTo: (id) =>
            selection.extendTo(
              id,
              reviews.map((r) => r.id)
            ),
        }}
      />
    )
  }

  // Below lg the detail opens as a sheet over the list. Its "Back to reviews"
  // control takes focus so keyboard and screen-reader users land somewhere
  // meaningful in the new surface instead of losing their place (ReviewList
  // re-focuses the originating row on the way back). `.focus()` on the
  // `lg:hidden` button is a silent no-op in the inspector column, where it is
  // `display: none`, so this is harmless on desktop.
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
          selection.extendTo(
            state.selected,
            reviews.map((review) => review.id)
          )
      },
      "clear-selection": () => selection.clear(),
      // `r` asks the composer to open and take focus. It does not decide
      // whether editing is allowed — the composer knows the review's
      // capabilities and its workflow status, and the hotkey layer must not
      // second-guess either.
      reply: () => {
        if (!state.selected) return
        window.dispatchEvent(new Event(REPLY_FOCUS_EVENT))
      },
    }),
    [onAdjacentReview, reviews, selection, state.selected]
  )

  const clientName = state.clientId
    ? clientsQuery.data?.items.find((client) => client.id === state.clientId)
        ?.name
    : undefined

  // Queue tabs, then the compact filter toolbar, then the chips of what is
  // applied — one block above the two panes, in place of the permanent rail.
  const workspaceControls = (
    <div
      data-slot="inbox-workspace-controls"
      className="flex shrink-0 flex-col gap-3"
    >
      <QueueTabs
        queue={state.queue}
        counts={countsQuery.data}
        countsPending={countsQuery.isPending}
        onQueueChange={onQueueChange}
      />
      <FilterToolbar
        state={state}
        locations={locationsQuery.data ?? []}
        clients={(clientsQuery.data?.items ?? []).map((client) => ({
          id: client.id,
          name: client.name,
        }))}
        showLocationFilter={showLocationFilter}
        onChange={onFilterChange}
        onQueueChange={onQueueChange}
        onClear={onClearFilters}
      />
      <ActiveFilterChips
        state={state}
        locations={locationsQuery.data ?? []}
        clientName={clientName}
        onChange={onFilterChange}
        onClear={onClearFilters}
      />
    </div>
  )

  const listPane = (
    <div
      data-slot="inbox-list-pane"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle px-3 py-2.5">
        {/* One review search, at the head of the rows it searches. The shell's
            ⌘K launcher is Commands — clients, venues and actions — and
            deliberately does not look inside review text, so there is exactly
            one place to type words a customer wrote. */}
        <ReviewSearchBar
          state={state}
          onChange={onFilterChange}
          className="min-w-0"
        />
      </div>
      {renderList()}
      {!reviewsQuery.isPending &&
      !reviewsQuery.isError &&
      reviews.length > 0 ? (
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-line-subtle px-3">
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
              size="xs"
              disabled={reviewsQuery.isFetchingNextPage}
              onClick={loadMore}
            >
              {reviewsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  const navigation = (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              pill
              aria-label="Previous review"
              disabled={!hasPrevReview}
              onClick={() => void onAdjacentReview("prev")}
            />
          }
        >
          <ChevronLeftIcon aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent>Previous review</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              pill
              aria-label="Next review"
              disabled={!hasNextReview || reviewsQuery.isFetchingNextPage}
              onClick={() => void onAdjacentReview("next")}
            />
          }
        >
          <ChevronRightIcon aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent>Next review</TooltipContent>
      </Tooltip>
    </div>
  )

  // The detail is mounted in exactly one place — the inspector column or the
  // sheet — so the composer's dirty guard is registered once.
  const detail = state.selected ? (
    <DetailErrorBoundary key={state.selected}>
      <div
        key={state.selected}
        className="flex min-h-0 flex-1 flex-col transition-opacity duration-(--np-duration-fast) ease-standard starting:opacity-0"
      >
        <ReviewDetail
          reviewId={state.selected}
          leading={
            // Mobile-only return-to-list affordance, pinned in the pane
            // header; Back also works because selection was pushed (spec §6).
            <Button
              ref={backButtonRef}
              variant="ghost"
              size="sm"
              onClick={onBackToList}
              className="lg:hidden"
            >
              <ArrowLeftIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
              Back to reviews
            </Button>
          }
          navigation={navigation}
          composer={<ReplyComposer reviewId={state.selected} />}
          actions={<ActionBar reviewId={state.selected} />}
        />
      </div>
    </DetailErrorBoundary>
  ) : null

  const inspector = (
    <section
      aria-label="Selected review"
      data-slot="inbox-inspector"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      {detail ?? (
        <Empty
          icon={<MessagesSquareIcon aria-hidden />}
          title="No review selected"
          description="Choose a review from the list to read it and reply."
          className="my-auto"
        />
      )}
    </section>
  )

  // Below lg, everything the sheet covers is parked together: the list AND the
  // workspace controls above it. Parking only the list used to leave the queue
  // tabs and the filter toolbar tabbable behind an open review.
  const parked = !isDesktop && Boolean(state.selected)

  return (
    <TooltipProvider>
      <div className="relative flex min-h-0 flex-1 flex-col gap-(--np-gap-card)">
        <InboxHotkeys handlers={hotkeyHandlers} />

        <div
          className={cn("flex shrink-0 flex-col", parked && "invisible")}
          inert={parked ? true : undefined}
        >
          {workspaceControls}
        </div>

        {isDesktop ? (
          // Three permanent regions: the application sidebar (owned by the
          // shell), this list, and the detail. The split starts at 40% — the
          // width the rail used to take now belongs to the reply — and both
          // panels keep a minimum that stays usable at 1024px.
          // The two `max-lg` guards only matter for the one frame between the
          // server's desktop guess and the client's measurement on a narrow
          // screen.
          <SplitPane orientation="horizontal" className="min-h-0 flex-1 gap-0">
            <SplitPanePanel
              defaultSize="40"
              minSize={300}
              className="min-h-0 max-lg:flex-1!"
            >
              {listPane}
            </SplitPanePanel>
            <SplitPaneHandle
              label="Resize the review list"
              className="mx-1.5 bg-transparent max-lg:hidden"
            />
            <SplitPanePanel minSize={420} className="min-h-0 max-lg:hidden">
              {inspector}
            </SplitPanePanel>
          </SplitPane>
        ) : (
          // While the detail sheet is up the list beneath it is parked: kept
          // in the tree so the selected row keeps its aria-current, but
          // invisible and inert so neither a swipe nor a screen reader lands
          // on a row the sheet is covering.
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              parked && "invisible"
            )}
            inert={parked ? true : undefined}
          >
            {listPane}
          </div>
        )}

        {/* Below lg the detail is a bottom sheet over the list. It is
            deliberately non-modal and never dismissed by an outside press: the
            discard-confirm AlertDialog lives outside it in the React tree, and
            a modal sheet would either hide the rest of the page from assistive
            tech or treat "Keep editing" as a tap on the scrim. The only ways
            out are "Back to reviews" and Escape, both dirty-gated. */}
        {!isDesktop ? (
          <Sheet
            open={Boolean(state.selected)}
            modal={false}
            disablePointerDismissal
            onOpenChange={(open) => {
              if (!open) onBackToList()
            }}
          >
            <SheetContent
              side="bottom"
              showCloseButton={false}
              initialFocus={backButtonRef}
              className="h-[calc(100dvh-1.5rem)]"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Selected review</SheetTitle>
                <SheetDescription>
                  The review, where its reply has got to, and your reply.
                </SheetDescription>
              </SheetHeader>
              {/* The same landmark the desktop inspector carries, so "Selected
                  review" is reachable by region on every width. */}
              <section
                aria-label="Selected review"
                data-slot="inbox-inspector"
                className="flex min-h-0 flex-1 flex-col"
              >
                {detail}
              </section>
            </SheetContent>
          </Sheet>
        ) : null}

        <BulkActionBar rows={reviews} />
      </div>
    </TooltipProvider>
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
