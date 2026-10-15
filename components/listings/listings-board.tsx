"use client"

import {
  ChevronDownIcon,
  CircleAlertIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import * as React from "react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { AddListingsLink } from "@/components/listings/add-listings-link"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FilterChip,
  FilterChipStrip,
  filterChipClassName,
} from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAllLabel,
} from "@/components/ui/table"
import { Toolbar } from "@/components/ui/toolbar"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber } from "@/lib/format"
import {
  googleChangedCount,
  listingHealth,
  listingHealthLabel,
  listingHealthTone,
  summariseListingHealth,
  unpublishedCount,
  type ListingHealth,
} from "@/lib/listings/health"
import { BULK_MAX_TARGETS } from "@/lib/domain/bulk-merge"
import { listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import { useClients } from "@/lib/queries/use-clients"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { useListingSummaries } from "@/lib/queries/use-listing-summary"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { cn } from "@/lib/utils"
import { useNow } from "@/lib/time/server-now"
import { replaceUrl } from "@/lib/navigation/shallow-url"

const HEALTH_FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "unpublished", label: "To publish" },
  { value: "not_linked", label: "Not linked" },
  { value: "healthy", label: "In sync" },
] as const
type HealthFilter = (typeof HEALTH_FILTERS)[number]["value"]

function isHealthFilter(value: string | null): value is HealthFilter {
  return HEALTH_FILTERS.some((filter) => filter.value === value)
}

/** Worst health first across every client, or grouped under each client. */
type BoardOrder = "health" | "client"

const BOARD_ORDERS: readonly { value: BoardOrder; label: string }[] = [
  { value: "health", label: "Worst first" },
  { value: "client", label: "By client" },
]

/**
 * The order, folded into the health strip as one chip ("Worst first ⌄"):
 * a menu of the two orders (a sheet on a phone) rather than a row of its
 * own. Styled as a filter chip, but not pressed: it names the current
 * choice instead of switching a filter on.
 */
function OrderChip({
  value,
  onChange,
  className,
}: {
  value: BoardOrder
  onChange: (next: BoardOrder) => void
  className?: string
}) {
  const current = BOARD_ORDERS.find((order) => order.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="order-chip"
        // The name contains the visible words (WCAG 2.5.3).
        aria-label={`Order listings: ${current?.label}`}
        className={filterChipClassName({
          className: cn("data-popup-open:bg-fill", className),
        })}
      >
        {current?.label}
        <ChevronDownIcon aria-hidden strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Order listings">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: string) => onChange(next as BoardOrder)}
        >
          {BOARD_ORDERS.map((order) => (
            <DropdownMenuRadioItem
              key={order.value}
              value={order.value}
              closeOnClick
              indicatorPosition="end"
            >
              {order.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const UNFILED = "__unfiled__"
/** As the inbox's search (review-filters.tsx): the URL follows a pause. */
const SEARCH_URL_DELAY_MS = 300

type BoardRow = {
  entry: DirectoryEntry
  summary: ListingSummary | undefined
  health: ListingHealth
  verified: boolean | undefined
  clientId: string
  clientName: string
}

function matchesHealth(health: ListingHealth, filter: HealthFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "attention":
      return (
        health === "attention" ||
        health === "disconnected" ||
        health === "access_lost"
      )
    case "unpublished":
      return health === "unpublished"
    case "not_linked":
      return health === "not_linked" || health === "pending_verification"
    case "healthy":
      return health === "healthy"
  }
}

/** Worst first, then by name, so the top of the board is the to-do list. */
const HEALTH_ORDER: Record<ListingHealth, number> = {
  disconnected: 0,
  access_lost: 0,
  attention: 1,
  unpublished: 2,
  pending_verification: 3,
  not_linked: 4,
  unchecked: 4,
  partially_checked: 4,
  healthy: 5,
}

/**
 * When this listing's reviews were last successfully checked with Google,
 * named as reviews: it says nothing about the profile, hours or menu.
 * and whether that is late. Only successful checks count, so a sync that
 * keeps failing shows its age here instead of looking fresh.
 */
function FreshnessLine({ summary }: { summary: ListingSummary | undefined }) {
  const freshness = summary?.freshness
  if (!freshness) return null
  const checked = freshness.lastCheckedAt ? (
    <RelativeTime iso={freshness.lastCheckedAt} prefix="Reviews checked " />
  ) : (
    "Reviews not checked yet"
  )
  return (
    <span
      className={cn(
        "text-caption",
        freshness.state === "data_delayed"
          ? "text-warning-ink"
          : "text-ink-muted"
      )}
    >
      {checked}
      {freshness.state === "data_delayed" ? " · delayed, retrying" : null}
    </span>
  )
}

/**
 * How many things wait on a listing, as one figure: the phone row's compact
 * stand-in for the Waiting column's pills.
 */
function waitingCount(summary: ListingSummary): number {
  return (
    unpublishedCount(summary) +
    googleChangedCount(summary) +
    summary.posts.awaitingApproval
  )
}

/** No summary, or nothing waiting and no failed publish. */
function quietRow(summary: ListingSummary | undefined) {
  if (!summary) return true
  const failed =
    summary.lastPublish?.status === "failed" || summary.posts.failed > 0
  return !failed && waitingCount(summary) === 0
}

/** The phone row's one-line Waiting figure (the pills show from 48rem). */
function WaitingFigure({ summary }: { summary: ListingSummary | undefined }) {
  if (!summary) return <span className="text-ink-muted">—</span>
  const failed =
    summary.lastPublish?.status === "failed" || summary.posts.failed > 0
  const count = waitingCount(summary)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-secondary">
      {count > 0 ? (
        <span className="tabular-nums">{formatNumber(count)} waiting</span>
      ) : failed ? null : (
        <span className="text-ink-muted">Nothing waiting</span>
      )}
      {failed ? <StatusPill tone="at-risk">Failed publish</StatusPill> : null}
    </span>
  )
}

function PendingChips({ summary }: { summary: ListingSummary | undefined }) {
  if (!summary) return <span className="text-ink-muted">—</span>
  const parts: {
    key: string
    label: string
    tone: "pending" | "attention" | "at-risk"
  }[] = []
  const unpublished = unpublishedCount(summary)
  if (unpublished > 0)
    parts.push({
      key: "unpublished",
      label:
        unpublished === 1
          ? "1 change to publish"
          : `${formatNumber(unpublished)} changes to publish`,
      tone: "pending",
    })
  const changed = googleChangedCount(summary)
  if (changed > 0)
    parts.push({
      key: "google",
      label:
        changed === 1
          ? "1 Google change"
          : `${formatNumber(changed)} Google changes`,
      tone: "attention",
    })
  if (summary.posts.awaitingApproval > 0)
    parts.push({
      key: "posts",
      label:
        summary.posts.awaitingApproval === 1
          ? "1 post awaiting approval"
          : `${formatNumber(summary.posts.awaitingApproval)} posts awaiting approval`,
      tone: "pending",
    })
  if (summary.lastPublish?.status === "failed" || summary.posts.failed > 0)
    parts.push({ key: "failed", label: "Failed publish", tone: "at-risk" })
  if (parts.length === 0)
    return <span className="text-ink-muted">Nothing waiting</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {parts.map((part) => (
        <StatusPill key={part.key} tone={part.tone}>
          {part.label}
        </StatusPill>
      ))}
    </span>
  )
}

function VerificationCell({ row }: { row: BoardRow }) {
  if (!row.entry.linked || row.verified === undefined)
    return <span className="text-ink-muted">—</span>
  return row.verified ? (
    <StatusPill tone="healthy">Verified</StatusPill>
  ) : (
    <StatusPill tone="attention">Not verified</StatusPill>
  )
}

const COLUMNS = [
  "Listing",
  "Client",
  "Health",
  "Waiting",
  "Verification",
  "Last published",
] as const

/** A business has no client layer, so its board has no Client column. */
function columnsFor(business: boolean) {
  return business ? COLUMNS.filter((column) => column !== "Client") : COLUMNS
}

/*
 * The phone row (the table's container under 48rem) is a record card laid
 * out by the Table's own cell priorities, the anatomy of a list row:
 *
 *   [select] Listing name ........................ ›
 *            Client · address           [health pill]
 *            n waiting
 *            Client: File under…   (unfiled rows only)
 *
 * The verification and last-published columns step aside (desk-only; they
 * are one tap away on the listing). These classes only show or hide content
 * INSIDE a cell, so none of them has to fight the table's own rules.
 */
const PHONE = {
  /** Shown only on the phone row. */
  only: "hidden @max-3xl/table:inline-flex",
  /** Inline text shown only on the phone row. */
  onlyInline: "hidden @max-3xl/table:inline",
  /** Shown only from 48rem. */
  wide: "@max-3xl/table:hidden",
} as const

/** The table's frame, shared by the loaded board and its skeleton. */
function BoardTable({
  children,
  busy = false,
  selectable = false,
  selectAll,
}: {
  children: React.ReactNode
  busy?: boolean
  /** Owners and admins select listings for a bulk change. */
  selectable?: boolean
  /**
   * The select-all checkbox and its TableSelectAllLabel, for the header's
   * selection column. As record cards (a phone) the header row hides but a
   * cell holding a checkbox survives as a bar above the cards, so one
   * control serves every width.
   */
  selectAll?: React.ReactNode
}) {
  const business = useWorkspaceMode() === "business"
  return (
    <Table surface responsive aria-busy={busy || undefined}>
      <caption className="sr-only">
        Listings, with their Google health and what is waiting on each
      </caption>
      <TableHeader>
        <TableRow>
          {selectable ? (
            <TableHead className="w-10">
              {selectAll ?? <span className="sr-only">Select</span>}
            </TableHead>
          ) : null}
          {columnsFor(business).map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function BoardSkeleton({ canManage = false }: { canManage?: boolean }) {
  const business = useWorkspaceMode() === "business"
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {/* The toolbar's shape: the search pill on its own row, then the
          chip strip (and, agency only, the order chip at its end). */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-(--np-touch) w-full rounded-(--np-radius-pill) desk:h-(--np-control-h)" />
        <div className="flex gap-1.5 overflow-hidden">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton
              key={index}
              className="h-(--np-chip-h) w-24 shrink-0 rounded-(--np-radius-pill)"
            />
          ))}
          {business ? null : (
            <Skeleton className="h-(--np-chip-h) w-28 shrink-0 rounded-(--np-radius-pill)" />
          )}
        </div>
      </div>
      <BoardTable busy>
        {[0, 1, 2, 3, 4].map((index) => (
          <TableRow key={index} aria-hidden>
            <TableCell priority="primary">
              <span className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </span>
            </TableCell>
            {business ? null : (
              <TableCell priority="desk-only">
                <Skeleton className="h-3.5 w-28" />
              </TableCell>
            )}
            <TableCell priority="trailing" className="@max-3xl/table:self-end">
              <Skeleton className="h-5.5 w-24" />
            </TableCell>
            <TableCell priority="meta">
              <Skeleton className="h-3.5 w-24 @3xl/table:h-5.5 @3xl/table:w-32" />
            </TableCell>
            <TableCell priority="desk-only">
              <Skeleton className="h-5.5 w-20" />
            </TableCell>
            <TableCell priority="desk-only">
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </BoardTable>
      {canManage ? (
        <div>
          <AddListingsLink />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Every listing the session can see, health first.
 *
 * By default the board is one list, worst health first across every client,
 * so the top of it is the to-do list. "By client" groups it instead: unfiled
 * listings lead, under their own group row, because that is where a newly
 * linked listing lands and the one thing it needs is a client. The search,
 * health, client and order choices live in the URL (`q`, `health`,
 * `clientId`, `order`), so a filtered board can be shared or reloaded. The
 * Waiting column reads the DB-only summary, so the board answers "what is
 * waiting on which listing" without a single Google call. Below 48rem of
 * width each row becomes a compact record (name; client · address with the
 * health pill; one waiting figure; chevron) that is one tap target, and the
 * filters are pressed buttons (client chips, health chips), so moving
 * through them by keyboard never re-filters the board. The order is one
 * chip at the end of the health strip that opens a menu of the two orders,
 * and "Add listings from Google" closes the list (it is not a header row
 * above the first listing).
 */
function ListingsBoard({
  role,
  bulkEnabled = false,
}: {
  role: string | null
  /** The organisation's `bulk_actions` feature; off hides bulk selection. */
  bulkEnabled?: boolean
}) {
  const now = useNow()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "admin"
  const canSelect = canManage && bulkEnabled
  // Explicit listing ids for a bulk change. Filters only change what is shown;
  // the bulk preview freezes exactly these ids.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const selectAllReasonId = React.useId()
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on && next.size < BULK_MAX_TARGETS) next.add(id)
      if (!on) next.delete(id)
      return next
    })
  const directory = useLocationDirectory(role)
  const clients = useClients()
  const summaries = useListingSummaries()
  // A business has no client layer: no Client column, chips, grouping or
  // filter, whatever a stale address says.
  const business = useWorkspaceMode() === "business"

  // Local state answers each keystroke at once; the URL follows it (replace,
  // not push, so Back leaves the board rather than undoing filters). The URL
  // is rewritten through the history API, so no change here asks the server
  // for anything, and a search waits for a pause in the typing.
  const [search, setSearchState] = React.useState(
    () => searchParams.get("q") ?? ""
  )
  const [health, setHealthState] = React.useState<HealthFilter>(() => {
    const value = searchParams.get("health")
    return isHealthFilter(value) ? value : "all"
  })
  const [clientFilterState, setClientState] = React.useState<string | null>(
    () => searchParams.get("clientId")
  )
  const clientFilter = business ? null : clientFilterState
  // The top-bar client switcher changes `?clientId=` from outside the board,
  // so the chips follow the address whenever it moves on its own. Adjusted
  // during render, not in an effect, so no frame shows the old client.
  const urlClient = searchParams.get("clientId")
  const [seenUrlClient, setSeenUrlClient] = React.useState(urlClient)
  if (urlClient !== seenUrlClient) {
    setSeenUrlClient(urlClient)
    setClientState(urlClient)
  }
  const [orderState, setOrderState] = React.useState<BoardOrder>(() =>
    searchParams.get("order") === "client" ? "client" : "health"
  )
  const order: BoardOrder = business ? "health" : orderState

  const pendingSearch = React.useRef<{ q: string; timer: number } | null>(null)
  React.useEffect(
    () => () => window.clearTimeout(pendingSearch.current?.timer),
    []
  )
  const writeUrl = (change: {
    q?: string
    health?: HealthFilter
    clientId?: string | null
    order?: BoardOrder
  }) => {
    // A search still waiting out its pause goes with this write, so neither
    // undoes the other.
    const pending = pendingSearch.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingSearch.current = null
    }
    const next =
      pending && change.q === undefined ? { ...change, q: pending.q } : change
    // The address as it is now, not as this render saw it: the top-bar
    // switcher can move `?clientId=` while a search waits.
    const params = new URLSearchParams(window.location.search)
    const set = (
      key: string,
      value: string | null | undefined,
      empty: string
    ) => {
      if (value === undefined) return
      if (value === null || value === empty) params.delete(key)
      else params.set(key, value)
    }
    set("q", next.q?.trim() === "" ? "" : next.q, "")
    set("health", next.health, "all")
    set("clientId", next.clientId, "")
    set("order", next.order, "health")
    const query = params.toString()
    replaceUrl(query ? `${pathname}?${query}` : pathname)
  }
  const setSearch = (value: string) => {
    setSearchState(value)
    window.clearTimeout(pendingSearch.current?.timer)
    pendingSearch.current = {
      q: value,
      timer: window.setTimeout(() => {
        pendingSearch.current = null
        writeUrl({ q: value })
      }, SEARCH_URL_DELAY_MS),
    }
  }
  const setHealth = (value: HealthFilter) => {
    setHealthState(value)
    writeUrl({ health: value })
  }
  const setClientFilter = (value: string | null) => {
    setClientState(value)
    writeUrl({ clientId: value })
  }
  const setOrder = (value: BoardOrder) => {
    setOrderState(value)
    writeUrl({ order: value })
  }

  if (directory.isPending) return <BoardSkeleton canManage={canManage} />
  // A failed background refetch keeps the board it already has.
  if (directory.isError && !directory.data) {
    return (
      <div className="flex flex-col gap-4">
        <Empty
          framed
          variant="error"
          titleAs="h2"
          title="We couldn’t load your listings"
          description="The listings service didn’t answer, so nothing is shown rather than a partial board. Nothing was changed."
          action={
            <Button
              variant="secondary"
              onClick={() => void directory.refetch()}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          }
        />
        {/* Setup does not depend on the directory, so owners and admins
            can still add listings while it is down. */}
        {canManage ? (
          <div>
            <AddListingsLink />
          </div>
        ) : null}
      </div>
    )
  }

  const summaryById = new Map(
    (summaries.data ?? []).map((summary) => [summary.locationId, summary])
  )
  const rows: BoardRow[] = (directory.data ?? []).map((entry) => {
    const summary = summaryById.get(entry.id)
    return {
      entry,
      summary,
      // Either source saying "not verified" wins, as it does for health.
      verified:
        entry.verified === false || summary?.verified === false
          ? false
          : (entry.verified ?? summary?.verified),
      health: listingHealth({
        linked: entry.linked,
        verified: entry.verified ?? summary?.verified,
        summary,
        now,
      }),
      clientId: entry.clientId ?? UNFILED,
      clientName: entry.clientName ?? "Not filed under a client",
    }
  })

  if (rows.length === 0) {
    return (
      <Empty
        framed
        icon={<StoreIcon />}
        titleAs="h2"
        title="No listings yet"
        description={
          canManage
            ? business
              ? "Connect your Google login and link your locations, and they appear here with their health."
              : "Connect a client’s Google login and link its locations, and they appear here with their health."
            : "Nothing is linked to Google yet. An owner or admin can add the first listing."
        }
        action={
          canManage ? (
            <Link
              href="/setup"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <PlusIcon aria-hidden strokeWidth={1.75} />
              Add listings from Google
            </Link>
          ) : undefined
        }
      />
    )
  }

  const needle = search.trim().toLowerCase()
  const inScope = rows
    .filter((row) => (clientFilter ? row.clientId === clientFilter : true))
    .filter((row) =>
      needle
        ? row.entry.name.toLowerCase().includes(needle) ||
          (!business && row.clientName.toLowerCase().includes(needle))
        : true
    )
  const visible = inScope
    .filter((row) => matchesHealth(row.health, health))
    .sort((a, b) => {
      const worst = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]
      if (order === "health")
        // Worst health first across every client, then by name.
        return worst !== 0 ? worst : a.entry.name.localeCompare(b.entry.name)
      // Unfiled first, then by client, then worst health, then name.
      if ((a.clientId === UNFILED) !== (b.clientId === UNFILED))
        return a.clientId === UNFILED ? -1 : 1
      if (a.clientId !== b.clientId)
        return a.clientName.localeCompare(b.clientName)
      return worst !== 0 ? worst : a.entry.name.localeCompare(b.entry.name)
    })

  const clientChips = business
    ? []
    : [
        ...(rows.some((row) => row.clientId === UNFILED)
          ? [
              {
                id: UNFILED,
                name: "Unfiled",
                count: rows.filter((row) => row.clientId === UNFILED).length,
              },
            ]
          : []),
        ...(clients.data?.items ?? []).map((client) => ({
          id: client.id,
          name: client.name,
          count: rows.filter((row) => row.clientId === client.id).length,
        })),
      ].filter((chip) => chip.count > 0)

  const grouped = !business && order === "client"
  const unfiled = grouped
    ? visible.filter((row) => row.clientId === UNFILED)
    : []
  const filed = grouped
    ? visible.filter((row) => row.clientId !== UNFILED)
    : visible

  const clearFilters = () => {
    setSearchState("")
    setHealthState("all")
    setClientState(null)
    writeUrl({ q: "", health: "all", clientId: null })
  }

  // "Select all shown" adds the shown listings to the selection (and clearing
  // it removes only them), so a filter never silently drops a listing picked
  // under another filter. It is offered only while the result stays within
  // the cap: the selection is explicit ids and is never trimmed to fit.
  const visibleIds = visible.map((row) => row.entry.id)
  const shownSelected = visibleIds.filter((id) => selected.has(id)).length
  const unionSize = selected.size + visibleIds.length - shownSelected
  const allShownSelected =
    visibleIds.length > 0 && shownSelected === visibleIds.length
  const selectAllBlocked = !allShownSelected && unionSize > BULK_MAX_TARGETS
  const selectAllName = `Select all shown (${formatNumber(visible.length)})`
  const setAllShown = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of visibleIds) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return on && next.size > BULK_MAX_TARGETS ? current : next
    })

  const renderRow = (row: BoardRow) => {
    const address = formatAddressLine(row.entry.address)
    const unfiledRow = row.clientId === UNFILED
    // The phone row names the client before the address ("Client ·
    // address"); a desk has its own Client column, so this part is phone
    // only. An unfiled row keeps its Client cell on the phone instead.
    const clientInSubtitle = !business && !unfiledRow
    return (
      <TableRow key={row.entry.id} interactive className="relative">
        {canSelect ? (
          <TableCell priority="select">
            {/* Above the row's stretched link, so a tap here selects. */}
            <span className="relative z-raised flex">
              <Checkbox
                checked={selected.has(row.entry.id)}
                disabled={
                  !selected.has(row.entry.id) &&
                  selected.size >= BULK_MAX_TARGETS
                }
                onCheckedChange={(checked) =>
                  toggle(row.entry.id, checked === true)
                }
                aria-label={`Select ${row.entry.name} for a bulk change`}
              />
            </span>
          </TableCell>
        ) : null}
        <TableCell priority="primary">
          <span className="flex min-w-0 flex-col">
            {/* The whole row is this link's target: its ::after stretches
                over the row (positioned), so a phone row is one tap and
                never a 24px line of text. No chevron of its own: the row is
                `interactive`, so the record card already draws one. */}
            <ShellLink
              href={listingHref(row.entry.id)}
              className="inline-flex min-h-(--np-control-h) items-center rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo after:absolute after:inset-0 after:content-[''] hover:underline @max-3xl/table:min-h-0 @max-3xl/table:text-body"
            >
              {row.entry.name}
            </ShellLink>
            {clientInSubtitle || address ? (
              <span className="text-caption break-words text-ink-muted">
                {clientInSubtitle ? (
                  <span className={PHONE.onlyInline}>
                    {row.clientName}
                    {address ? " · " : null}
                  </span>
                ) : null}
                {address}
              </span>
            ) : null}
          </span>
        </TableCell>
        {business ? null : unfiledRow ? (
          // Unfiled: the one thing this listing needs, so it stays on the
          // phone row as a labelled line under the record.
          <TableCell priority="detail" label="Client" span>
            {canManage ? (
              <span className="relative z-raised inline-flex max-w-full">
                <FileUnderClient
                  locationId={row.entry.id}
                  locationName={row.entry.name}
                />
              </span>
            ) : (
              <span className="text-ink-muted">Not filed</span>
            )}
          </TableCell>
        ) : (
          <TableCell priority="desk-only">
            <span className="flex min-w-0 items-center gap-2">
              <ClientAvatar name={row.clientName} colour={null} size="sm" />
              <span className="min-w-0 break-words">{row.clientName}</span>
            </span>
          </TableCell>
        )}
        {/* On the phone the health pill closes the subtitle line. */}
        <TableCell priority="trailing" className="@max-3xl/table:self-end">
          <span className="flex flex-col items-start gap-1 @max-3xl/table:items-end">
            {/* While the summaries are still loading, "Not checked" would
                contradict the "Checking each listing…" announcement, so the
                pill waits. A health known without a summary still shows. */}
            {summaries.isPending && row.health === "unchecked" ? null : (
              <StatusPill tone={listingHealthTone(row.health)}>
                {listingHealthLabel(row.health)}
              </StatusPill>
            )}
            <span className={PHONE.wide}>
              <FreshnessLine summary={row.summary} />
            </span>
          </span>
        </TableCell>
        <TableCell priority="meta">
          {summaries.isPending ? (
            <Skeleton className="h-3.5 w-24 @3xl/table:h-5.5 @3xl/table:w-32" />
          ) : quietRow(row.summary) ? (
            // One node at every width: a quiet row says so once, not once
            // per layout (the phone figure and the pills would repeat it).
            <span className="text-caption text-ink-muted @3xl/table:text-ui">
              {row.summary ? "Nothing waiting" : "—"}
            </span>
          ) : (
            <>
              <span className={PHONE.wide}>
                <PendingChips summary={row.summary} />
              </span>
              <span className={PHONE.only}>
                <WaitingFigure summary={row.summary} />
              </span>
            </>
          )}
        </TableCell>
        <TableCell priority="desk-only">
          <VerificationCell row={row} />
        </TableCell>
        <TableCell priority="desk-only">
          {summaries.isPending ? (
            <Skeleton className="h-3.5 w-20" />
          ) : (
            <span className="text-caption text-ink-muted tabular-nums">
              {/* No summary means we don't know, not that it never happened. */}
              {!row.summary ? (
                "—"
              ) : row.summary.lastPublish ? (
                <RelativeTime iso={row.summary.lastPublish.at} />
              ) : (
                "Never"
              )}
            </span>
          )}
        </TableCell>
      </TableRow>
    )
  }

  const healthCount = (filter: HealthFilter) =>
    inScope.filter((row) => matchesHealth(row.health, filter)).length

  return (
    <div className="flex flex-col gap-4">
      {/* The toolbar (Drop 1 `Toolbar`): the search pill on its own row,
          full width at every size, so it never shares a 320px row with the
          order control. On a phone, focusing it is Notion Mail's search
          takeover (a "Cancel" that clears the query). Not sticky: the chips
          and the summary under it scroll with the board. */}
      <div className="flex min-w-0 flex-col gap-3">
        <Toolbar
          sticky={false}
          className="bg-transparent py-0"
          searchLabel="Search listings"
          searchPlaceholder={
            business ? "Search listings" : "Search listings or clients"
          }
          searchValue={search}
          onSearchChange={setSearch}
        />
        {/* Two chip strips (health with the order chip, then clients).
            Each strip is its own FilterChipStrip so each keeps ITS pressed
            chip in view: on a phone a strip scrolls sideways (edge fade)
            rather than truncating a label; from md it wraps, so a desk sees
            every chip. Each chip is a 44px target on touch. A health chip
            with nothing in it is not drawn, unless it is the one chosen (so
            it can be left) or "All". */}
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
          <FilterChipStrip className="-mx-5 px-5 md:mx-0 md:flex-wrap md:px-0.5">
            <div
              role="group"
              aria-label="Filter by health"
              className="flex shrink-0 gap-1.5 md:shrink md:flex-wrap md:gap-y-4 desk:gap-y-1.5"
            >
              {HEALTH_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  pressed={health === filter.value}
                  onClick={() => setHealth(filter.value)}
                  count={formatNumber(healthCount(filter.value))}
                  hideWhenZero={filter.value !== "all"}
                >
                  {filter.label}
                </FilterChip>
              ))}
            </div>
            {business ? null : (
              // Its own menu, so choosing an order never re-filters the
              // board or moves the pressed chip.
              <OrderChip
                value={order}
                onChange={setOrder}
                className="md:ml-auto"
              />
            )}
          </FilterChipStrip>
          {clientChips.length > 1 ? (
            <FilterChipStrip className="-mx-5 px-5 md:mx-0 md:flex-wrap md:border-l md:border-line md:px-0.5 md:pl-3">
              <div
                role="group"
                aria-label="Filter by client"
                className="flex shrink-0 gap-1.5 md:shrink md:flex-wrap md:gap-y-4 desk:gap-y-1.5"
              >
                <FilterChip
                  pressed={clientFilter === null}
                  onClick={() => setClientFilter(null)}
                  count={formatNumber(rows.length)}
                >
                  All clients
                </FilterChip>
                {clientChips.map((chip) => {
                  const pressed = clientFilter === chip.id
                  return (
                    <FilterChip
                      key={chip.id}
                      pressed={pressed}
                      onClick={() => setClientFilter(pressed ? null : chip.id)}
                      count={formatNumber(chip.count)}
                    >
                      {chip.id === UNFILED ? (
                        <CircleAlertIcon aria-hidden strokeWidth={1.75} />
                      ) : null}
                      {chip.name}
                    </FilterChip>
                  )
                })}
              </div>
            </FilterChipStrip>
          ) : null}
        </div>
        {/* The count line, spoken rather than drawn: a polite live region
            that announces "Checking each listing…" while the summaries load,
            then how many listings there are (all of them, not just those a
            filter leaves) and how healthy. It is drawn only when the check
            of what is waiting failed, so that is never silent on screen. */}
        <p
          className={
            summaries.isError ? "text-caption text-ink-muted" : "sr-only"
          }
          aria-live="polite"
        >
          {summaries.isPending ? (
            "Checking each listing…"
          ) : (
            <>
              <span className="tabular-nums">
                {rows.length === 1
                  ? "1 listing"
                  : `${formatNumber(rows.length)} listings`}
              </span>
              {" · "}
              <span>
                {summariseListingHealth(rows.map((row) => row.health))}
              </span>
              {summaries.isError ? (
                <span>
                  . We couldn’t check what is waiting on each listing.
                </span>
              ) : (
                <span>.</span>
              )}
            </>
          )}
        </p>
      </div>

      {visible.length === 0 ? (
        <Empty
          framed
          illustration={<EmptyIllustration name="search" />}
          title="No listings match"
          description={
            business
              ? "Nothing fits this health and search together. Widen one of them to see the rest."
              : "Nothing fits this client, health and search together. Widen one of them to see the rest."
          }
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {selectAllBlocked ? (
            // Why select-all is off, in words at every width: the header
            // cell is a narrow column on a desk, so the reason sits above
            // the table and describes the checkbox.
            <p
              id={selectAllReasonId}
              className="px-1 text-caption text-ink-muted"
            >
              One bulk change covers at most {BULK_MAX_TARGETS} listings. Narrow
              the board or select listings one by one.
            </p>
          ) : null}
          <BoardTable
            selectable={canSelect}
            selectAll={
              canSelect ? (
                <>
                  <Checkbox
                    aria-label={selectAllName}
                    aria-describedby={
                      selectAllBlocked ? selectAllReasonId : undefined
                    }
                    checked={allShownSelected}
                    indeterminate={!allShownSelected && shownSelected > 0}
                    disabled={selectAllBlocked}
                    onCheckedChange={(checked) => setAllShown(checked === true)}
                  />
                  {/* The record cards' select-all bar: the words start with
                      the checkbox's own name (WCAG 2.5.3 label in name). */}
                  <TableSelectAllLabel>
                    {selected.size > 0
                      ? `${selectAllName} · ${formatNumber(selected.size)} selected`
                      : selectAllName}
                  </TableSelectAllLabel>
                </>
              ) : undefined
            }
          >
            {!business && unfiled.length > 0 ? (
              <TableRow group>
                <TableCell colSpan={COLUMNS.length + (canSelect ? 1 : 0)}>
                  Not filed under a client · {formatNumber(unfiled.length)}
                </TableCell>
              </TableRow>
            ) : null}
            {unfiled.map(renderRow)}
            {!business && unfiled.length > 0 && filed.length > 0 ? (
              <TableRow group>
                <TableCell colSpan={COLUMNS.length + (canSelect ? 1 : 0)}>
                  Filed under a client · {formatNumber(filed.length)}
                </TableCell>
              </TableRow>
            ) : null}
            {filed.map(renderRow)}
          </BoardTable>
        </div>
      )}
      {/* Owners and admins only, as the header action it replaces was. At
          the end of the list so the first listing is not pushed down by it. */}
      {canManage ? (
        <div>
          <AddListingsLink />
        </div>
      ) : null}
      {/* Docked to the bottom of a phone (the tab bar steps aside for it,
          see the chrome contract in globals.css), riding the keyboard, with
          a spacer that keeps the last listing reachable above it; sticky
          under the board on a desk. Only there while something is
          selected, so there is one bottom bar at a time. */}
      <ActionBar
        dock
        visible={canSelect && selected.size > 0}
        label="Bulk change selection"
        offset="bottom-3"
        safeArea={false}
        status={
          <span>
            <span className="font-semibold tabular-nums">
              {formatNumber(selected.size)}
            </span>{" "}
            selected
            {selected.size >= BULK_MAX_TARGETS ? (
              <ActionBarMuted> (the most one change can cover)</ActionBarMuted>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost-dark"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
            <Link
              href={`/listings/bulk?ids=${[...selected].join(",")}`}
              className={buttonVariants({ size: "sm" })}
            >
              Prepare bulk change
            </Link>
          </>
        }
      />
    </div>
  )
}

export { ListingsBoard }
