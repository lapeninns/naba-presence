"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { InboxToolbar } from "@/components/inbox/inbox-toolbar"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import { ReviewList } from "@/components/inbox/review-list"
import { GoogleFreshness } from "@/components/inbox/google-freshness"
import { EmptyState, Statement } from "@/components/inbox/empty-states"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { QueryStates } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
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
  VISIBLE_QUEUES,
  visibleQueue,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import { REVIEW_QUEUE_LABELS } from "@/lib/contracts/reviews"
import { adjacentReviewId, type AdjacentDirection } from "@/lib/inbox/queue-nav"
import {
  PRIMARY_ACTION_EVENT,
  PUBLISH_PULSE_EVENT,
  PUBLISH_PULSE_MS,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
  SEARCH_FOCUS_EVENT,
  type PublishPulseDetail,
} from "@/lib/inbox/events"
import type { ReviewRow } from "@/lib/api/reviews"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSession, useSessionRole } from "@/lib/queries/use-session"
import { formatNumber } from "@/lib/format"

/**
 * On a phone the panes run edge to edge (reference `.panel` below 768px): the
 * page gutter is cancelled and the card loses its side borders and corners.
 */
const PHONE_BLEED = "max-md:-mx-4 max-md:rounded-none max-md:border-x-0"

/** The nearest ancestor that scrolls: the shell's column, or the document. */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current) {
    const { overflowY } = window.getComputedStyle(current)
    if (overflowY === "auto" || overflowY === "scroll") return current
    current = current.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

/** "14:32" — when this list was last fetched, in the viewer's own clock. */
function refreshedAt(timestamp: number | undefined): string | null {
  if (!timestamp) return null
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function InboxViewInner({
  showLocationFilter,
  actions,
}: {
  showLocationFilter: boolean
  actions?: ReactNode
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
  // Scoped to the client in view, so a queue's badge counts the rows that
  // queue will show. Unscoped, this is the key the page prefetches.
  const countsQuery = useReviewCounts({ clientId: state.clientId })
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
  const session = useSession()
  const role = useSessionRole()
  const locationsQuery = useLocationDirectory(role)
  // A viewer cannot assign, mark or approve, so the bulk tools — the tick
  // boxes and the bar they raise — are not offered (reference: the bulk bar
  // is hidden for view-only access). The server refuses them regardless.
  const canBatch = role !== "viewer"
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

  // Filters use replace (no history spam) and drop any stale selection —
  // unless the open reply holds unsaved edits. Then the review stays open
  // and only the list narrows: the discard confirm used to pop up a moment
  // after each debounced keystroke in the search, for an edit the search had
  // no reason to touch. The review is fetched by id, so it keeps rendering
  // whether or not the narrowed list still contains it.
  const onFilterChange = useCallback(
    (partial: Partial<InboxState>) => {
      if (readIsDirty()) {
        updateState(partial, "replace")
        return
      }
      updateState({ ...partial, selected: undefined }, "replace")
    },
    [readIsDirty, updateState]
  )
  const onQueueChange = useCallback(
    (queue: Queue) => {
      void (async () => {
        if (!(await dirtyGate())) return
        // The client scope survives a queue change: an operator moving from
        // one client's Needs reply to its Failed queue is still working that
        // client.
        updateState({ queue, selected: undefined }, "replace")
      })()
    },
    [dirtyGate, updateState]
  )
  // Opening a review from the list on a phone pushes, so Back returns to the
  // list (spec §6). Every other change of selection — a click beside the
  // list, the arrows, j / k, the advance after a publish — replaces: walking
  // a backlog of fifty reviews used to leave fifty history entries between
  // the operator and the page they came from. Gated behind the dirty guard:
  // while the composer is dirty this either confirms discarding the edit
  // (AlertDialog) or blocks the selection change. The boolean return tells
  // ReviewList's arrow-key handler whether it's safe to move DOM focus onto
  // the target row (see review-list.tsx).
  // Notes where the list was scrolled before a narrow screen swaps it for the
  // detail (kept current by an effect further down, beside the restore).
  const onBeforeOpenRef = useRef<() => void>(() => {})
  const rootRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLElement>(null)
  const savedScroll = useRef<{ page: number; list: number } | null>(null)
  const onSelect = useCallback(
    async (id: string): Promise<boolean> => {
      if (!(await dirtyGate())) return false
      onBeforeOpenRef.current()
      const opensFromList = !isDesktop && !state.selected
      updateState({ selected: id }, opensFromList ? "push" : "replace")
      return true
    },
    [dirtyGate, isDesktop, state.selected, updateState]
  )
  // Like a filter change: a dirty reply stays open while the list widens.
  const onClearFilters = useCallback(() => {
    router.replace(
      `/inbox?${serializeInboxState({
        queue: state.queue,
        locationIds: [],
        ratings: [],
        search: "",
        sort: "updated_desc",
        selected: readIsDirty() ? state.selected : undefined,
      }).toString()}`
    )
  }, [readIsDirty, router, state.queue, state.selected])
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

  // Resolves to the review it moved to, or null when it did not move.
  const onAdjacentReview = useCallback(
    async (direction: AdjacentDirection): Promise<ReviewRow | null> => {
      if (!(await dirtyGate())) return null
      const nextId = adjacentReviewId(reviews, state.selected, direction)
      if (nextId) {
        updateState({ selected: nextId }, "replace")
        return reviews.find((review) => review.id === nextId) ?? null
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
          updateState({ selected: firstNew.id }, "replace")
          return firstNew
        }
      }
      return null
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
      // Nobody asked for this navigation, so it must not move the page:
      // Next's default scrolls to and focuses the segment, which slid the
      // org-wide reconnect banner under the toolbar on every desktop load.
      router.replace(
        `/inbox?${serializeInboxState({ ...state, selected: id }).toString()}`,
        { scroll: false }
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
  //
  // The advance was the operator's doing — they pressed Publish or Approve —
  // so it says what happened and where they now are, and puts focus on the
  // new review's name. Without that, keyboard and screen-reader users were
  // left on a Publish button that had been unmounted under them.
  const [advance, setAdvance] = useState<{
    reviewId: string
    message: string
  } | null>(null)
  const advanceTargetRef = useRef<string | null>(null)
  const onAdjacentReviewRef = useRef(onAdjacentReview)
  const selectedRef = useRef(state.selected)
  const reviewsRef = useRef(reviews)
  const selectReviewRef = useRef((id: string) => {
    updateState({ selected: id }, "replace")
  })
  useEffect(() => {
    onAdjacentReviewRef.current = onAdjacentReview
    selectedRef.current = state.selected
    reviewsRef.current = reviews
    selectReviewRef.current = (id: string) => {
      updateState({ selected: id }, "replace")
    }
  }, [onAdjacentReview, reviews, state.selected, updateState])
  useEffect(() => {
    let timer: number | undefined
    function onPublished(event: Event) {
      const detail = (event as CustomEvent<PublishPulseDetail>).detail
      const reviewId = detail?.reviewId
      if (!reviewId || reviewId !== selectedRef.current) return
      const outcome =
        detail.status === "pending"
          ? "Reply sent to Google."
          : "Reply published."
      const arrivedAt = (row: ReviewRow | null | undefined) => {
        if (!row) return
        advanceTargetRef.current = row.id
        const name = row.reviewer.isAnonymous ? null : row.reviewer.displayName
        setAdvance({
          reviewId: row.id,
          message: name
            ? `${outcome} Now showing ${name}'s review.`
            : `${outcome} Now showing the next review.`,
        })
      }
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
          arrivedAt(current.find((review) => review.id === target))
          return
        }
        const shifted = index >= 0 ? current[index] : undefined
        if (shifted && shifted.id !== reviewId) {
          selectReviewRef.current(shifted.id)
          arrivedAt(shifted)
          return
        }
        void onAdjacentReviewRef.current("next").then(arrivedAt)
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

  // The same three lines a real row draws: the stars, name and age; two
  // lines of review; the venue and the status.
  function renderListSkeleton() {
    return (
      <div aria-busy="true" className="flex flex-col">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 border-b border-line py-3 pr-3.5 pl-3"
          >
            <span />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-[55%]" />
              <Skeleton className="h-3.5 w-[90%]" />
              <Skeleton className="h-3.5 w-[35%]" />
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
      // The counts are already scoped to the client in view, so the client
      // filter is the scope here rather than a filter hiding rows: an empty
      // queue for one client is that client's queue being clear.
      const facts = {
        hasActiveFilters: hasActiveFilters({ ...state, clientId: undefined }),
        queue: state.queue,
        totalOutsideFilters: countsQuery.data?.total ?? 0,
        connection:
          health.status === "disconnected"
            ? ("disconnected" as const)
            : health.status === "connected"
              ? ("connected" as const)
              : ("unknown" as const),
        clients: scopedClients,
        noClients:
          clientsQuery.isSuccess &&
          (clientsQuery.data?.items ?? []).length === 0,
      }
      // From an empty queue, the next one along that has work in it.
      const current = visibleQueue(state.queue)
      const start = current ? VISIBLE_QUEUES.indexOf(current) : -1
      const next = [
        ...VISIBLE_QUEUES.slice(start + 1),
        ...VISIBLE_QUEUES.slice(0, Math.max(start, 0)),
      ].find(
        (queue) =>
          queue !== current && (countsQuery.data?.byQueue[queue] ?? 0) > 0
      )
      return (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <EmptyState
            reason={emptyReason(facts)}
            counts={emptyCounts(facts)}
            onClear={onClearFilters}
            queue={state.queue}
            nextQueue={
              next
                ? {
                    label: REVIEW_QUEUE_LABELS[next],
                    count: countsQuery.data?.byQueue[next] ?? 0,
                    onSelect: () => onQueueChange(next),
                  }
                : undefined
            }
            canManageClients={role === "owner" || role === "admin"}
          />
        </div>
      )
    }
    return (
      <ReviewList
        ref={listScrollRef}
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
        selection={
          canBatch
            ? {
                selected: selection.selected,
                toggle: (id) => selection.toggle(id),
                extendTo: (id) =>
                  selection.extendTo(
                    id,
                    reviews.map((r) => r.id)
                  ),
              }
            : undefined
        }
      />
    )
  }

  // On a phone the detail replaces the list in place; its "Back to reviews"
  // control takes focus so keyboard and screen-reader users land somewhere
  // meaningful instead of losing their place (ReviewList re-focuses the
  // originating row on the way back).
  // After an advance the new review's name takes focus instead (ReviewDetail's
  // `focusHeading`).
  const backButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!state.selected) return
    if (advanceTargetRef.current === state.selected) {
      advanceTargetRef.current = null
      return
    }
    backButtonRef.current?.focus({ preventScroll: true })
  }, [state.selected])

  // `r`, `g` and `a` are handled by the detail pane's own controls, which
  // know whether they are currently allowed; the hotkey layer only asks.
  // Firing a publish from here would bypass every gate the action bar
  // applies, so `a` asks the bar to press its own main button.
  const hotkeyHandlers = useMemo(
    () => ({
      next: () => void onAdjacentReview("next"),
      previous: () => void onAdjacentReview("prev"),
      // A viewer has no bulk tools, so the selection keys are not bound
      // (and not listed in the shortcuts dialog) for them.
      ...(canBatch
        ? {
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
          }
        : {}),
      // `r` asks the composer to open and take focus. It does not decide
      // whether editing is allowed — the composer knows the review's
      // capabilities and its workflow status, and the hotkey layer must not
      // second-guess either.
      reply: () => {
        if (!state.selected) return
        window.dispatchEvent(new Event(REPLY_FOCUS_EVENT))
      },
      // A viewer can neither draft nor publish, so these are not bound (and
      // not listed) for them.
      ...(canBatch
        ? {
            generate: () => {
              if (!state.selected) return
              window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
            },
            approve: () => {
              if (!state.selected) return
              window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT))
            },
          }
        : {}),
      search: () => window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT)),
    }),
    [canBatch, onAdjacentReview, reviews, selection, state.selected]
  )

  const clientName = state.clientId
    ? clientsQuery.data?.items.find((client) => client.id === state.clientId)
        ?.name
    : undefined

  // One compact toolbar (title, search, queues, filters), then the chips of
  // what is applied — one block above the two panes. Every change goes
  // through the same dirty-gated handlers as the list.
  const workspaceControls = (
    <div
      data-slot="inbox-workspace-controls"
      className="flex shrink-0 flex-col gap-3"
    >
      <InboxToolbar
        state={state}
        counts={countsQuery.data}
        countsPending={countsQuery.isPending}
        locations={locationsQuery.data ?? []}
        clients={(clientsQuery.data?.items ?? []).map((client) => ({
          id: client.id,
          name: client.name,
        }))}
        showLocationFilter={showLocationFilter}
        actions={actions}
        onFilterChange={onFilterChange}
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

  const loaded = !reviewsQuery.isPending && !reviewsQuery.isError
  const ticked = reviews.filter((review) => selection.selected.has(review.id))
  const allTicked = reviews.length > 0 && ticked.length === reviews.length
  const refreshed = refreshedAt(reviewsQuery.dataUpdatedAt)
  const countLabel = reviewsQuery.isPending
    ? "Loading reviews…"
    : reviewsQuery.isError
      ? "Queue unavailable"
      : `${formatNumber(reviews.length)} ${
          reviews.length === 1 ? "review" : "reviews"
        }${reviewsQuery.hasNextPage ? " so far" : ""}`
  // "Adjusting state when a prop changes": the announcement follows the
  // filter set, and only once its first page has landed.
  const filtersKey = JSON.stringify(filters)
  const [countAnnouncement, setCountAnnouncement] = useState({
    key: "",
    text: "",
  })
  if (reviewsReady && countAnnouncement.key !== filtersKey) {
    setCountAnnouncement({ key: filtersKey, text: countLabel })
  }

  // Reference `.queue`: a card with a quiet head (select all, how many,
  // when the list was fetched), the rows, and the bulk bar pinned under
  // them when something is ticked. Where the workspace is locked to the
  // window the rows scroll inside the card; everywhere else the page does.
  // On a phone the card runs edge to edge, as the whole screen is the list.
  const listPane = (
    <section
      aria-label="Reviews"
      data-slot="inbox-list-pane"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col rounded-(--np-radius-card) border border-line bg-surface md:[@media(min-height:620px)]:overflow-hidden",
        PHONE_BLEED
      )}
    >
      <div className="flex min-h-11 shrink-0 items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] text-ink-muted">
        {canBatch ? (
          <Checkbox
            checked={allTicked}
            indeterminate={ticked.length > 0 && !allTicked}
            disabled={!loaded || reviews.length === 0}
            aria-label="Select every review in this view"
            onCheckedChange={(checked) => {
              if (checked) selection.replace(reviews.map((review) => review.id))
              else selection.clear()
            }}
          />
        ) : null}
        <span className="whitespace-nowrap tabular-nums">{countLabel}</span>
        {/* The count is spoken once per queue or filter change, not again
            every time another page of rows arrives — scrolling a backlog
            used to announce "50 reviews so far", "100 reviews so far"… */}
        <span role="status" className="sr-only">
          {countAnnouncement.text}
        </span>
        <span aria-hidden className="flex-1" />
        <GoogleFreshness
          clientId={state.clientId}
          className="min-w-0 truncate max-2xl:hidden"
        />
        {loaded && refreshed ? (
          <span
            className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted tabular-nums"
            title="When this list was last fetched from NabaPresence. Counts cover every review in each queue for the current client scope."
          >
            Refreshed {refreshed}
          </span>
        ) : null}
      </div>
      {renderList()}
      {loaded && reviews.length > 0 && reviewsQuery.hasNextPage ? (
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-t border-line px-3">
          <span className="text-caption text-ink-muted">
            More reviews below
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={reviewsQuery.isFetchingNextPage}
            onClick={loadMore}
          >
            {reviewsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      {canBatch ? <BulkActionBar rows={reviews} /> : null}
    </section>
  )

  // Up and down, because the queue they step through is a column (and `k`
  // and `j` move the same way).
  const navigation = (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous review"
              // The touch floor on a narrow screen too, as the head's other
              // controls have (`icon-sm` already grows on a coarse pointer).
              className="max-md:size-11"
              disabled={!hasPrevReview}
              onClick={() => void onAdjacentReview("prev")}
            />
          }
        >
          <ChevronUpIcon aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent>
          Previous review <Kbd>K</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next review"
              className="max-md:size-11"
              disabled={!hasNextReview || reviewsQuery.isFetchingNextPage}
              onClick={() => void onAdjacentReview("next")}
            />
          }
        >
          <ChevronDownIcon aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent>
          Next review <Kbd>J</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  )

  const selectedRow = reviews.find((review) => review.id === state.selected)

  // The detail is mounted in exactly one place, so the composer's dirty guard
  // is registered once.
  const detail = state.selected ? (
    <DetailErrorBoundary key={state.selected}>
      <ReviewDetail
        key={state.selected}
        reviewId={state.selected}
        clientName={selectedRow?.location.clientName ?? null}
        clientId={selectedRow?.location.clientId ?? null}
        organisationName={session.data?.session?.organisationName}
        focusHeading={advance?.reviewId === state.selected}
        leading={
          // The return-to-list control, on phones only; Back also works
          // because selection was pushed (spec §6). An arrow, as in the
          // reference; its name says where it goes.
          <Button
            ref={backButtonRef}
            variant="ghost"
            size="icon"
            aria-label="Back to reviews"
            onClick={onBackToList}
            className="md:hidden"
          >
            <ArrowLeftIcon aria-hidden strokeWidth={1.75} />
          </Button>
        }
        navigation={navigation}
        composer={<ReplyComposer reviewId={state.selected} />}
        actions={<ActionBar reviewId={state.selected} />}
      />
    </DetailErrorBoundary>
  ) : null

  // Reference `.detail`: a card whose head and publish bar stay put while
  // the thread scrolls — where the workspace is locked to the window. On a
  // phone or a short window it is an ordinary block in the page and the
  // publish bar is sticky at the foot of the screen instead, so it is never
  // out of reach and never clipped.
  const inspector = (
    <section
      aria-label="Selected review"
      data-slot="inbox-inspector"
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-(--np-radius-card) border border-line bg-surface md:[@media(min-height:620px)]:overflow-hidden",
        PHONE_BLEED
      )}
    >
      {detail ?? (
        <Statement
          title="No review selected"
          description="Pick a review from the list, or press J to open the first one."
          className="my-auto"
        />
      )}
    </section>
  )

  // On a phone the list and the detail take turns (reference `data-view`):
  // opening a review hides the list and the controls above it, and Back
  // brings them back where they were.
  const detailOnly = !isDesktop && Boolean(state.selected)

  // Where the list was when a review was opened, so returning to it lands on
  // the same rows rather than at the top. Both scrollers are kept: the page
  // (phones, short windows) and the list's own (the locked tablet workspace).
  const wasDetailOnly = useRef(detailOnly)
  useLayoutEffect(() => {
    const scroller = scrollParent(rootRef.current)
    if (detailOnly && !wasDetailOnly.current) {
      // Opening: start the review at its head.
      if (scroller) scroller.scrollTop = 0
    } else if (!detailOnly && wasDetailOnly.current && savedScroll.current) {
      const saved = savedScroll.current
      savedScroll.current = null
      if (scroller) scroller.scrollTop = saved.page
      if (listScrollRef.current) listScrollRef.current.scrollTop = saved.list
    }
    wasDetailOnly.current = detailOnly
  }, [detailOnly])
  useEffect(() => {
    onBeforeOpenRef.current = () => {
      if (isDesktop || state.selected) return
      savedScroll.current = {
        page: scrollParent(rootRef.current)?.scrollTop ?? 0,
        list: listScrollRef.current?.scrollTop ?? 0,
      }
    }
  }, [isDesktop, state.selected])

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        data-slot="inbox"
        data-view={detailOnly ? "detail" : "list"}
        // `min-h-0` only where the workspace is locked to the window: there
        // the panes share the height and scroll inside. Everywhere else the
        // inbox is as tall as its content and the page scrolls.
        className="relative flex flex-1 flex-col gap-3 xl:gap-4 md:[@media(min-height:620px)]:min-h-0"
      >
        <InboxHotkeys handlers={hotkeyHandlers} />
        <p role="status" className="sr-only" data-slot="inbox-advance-status">
          {advance?.message}
        </p>

        <div className="flex shrink-0 flex-col" hidden={detailOnly}>
          {workspaceControls}
        </div>

        <div
          data-slot="inbox-split"
          // Reference `.work`: a 280–340px queue beside the thread from
          // 768px, widening to a third of the room (320–420px) from 1280px.
          className={cn(
            "grid flex-1 grid-cols-1 gap-3 xl:gap-4 md:[@media(min-height:620px)]:min-h-0 md:[@media(min-height:620px)]:[grid-template-rows:minmax(0,1fr)]",
            isDesktop &&
              "md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[clamp(320px,32%,420px)_minmax(0,1fr)]"
          )}
        >
          {/* Kept in the tree while a review is open on a narrow screen, so
              the selected row keeps its aria-current and the list its place,
              but hidden from everyone. */}
          <div
            className="flex min-w-0 flex-col md:[@media(min-height:620px)]:min-h-0"
            hidden={detailOnly}
          >
            {listPane}
          </div>
          {isDesktop || state.selected ? inspector : null}
        </div>
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
  actions,
}: {
  showLocationFilter?: boolean
  /** The route's page actions (shortcuts, sync), drawn in the toolbar. */
  actions?: ReactNode
}) {
  return (
    <DirtyGuardProvider>
      <SelectionProvider>
        <InboxViewInner
          showLocationFilter={showLocationFilter}
          actions={actions}
        />
      </SelectionProvider>
    </DirtyGuardProvider>
  )
}

export { InboxView }
