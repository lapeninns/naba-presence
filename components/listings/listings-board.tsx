"use client"

import {
  ChevronRightIcon,
  CircleAlertIcon,
  FilterIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChipCount, ChipRow, ToggleChip } from "@/components/ui/chip"
import { Empty } from "@/components/ui/empty"
import { SearchInput } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber, formatRelativeTime } from "@/lib/format"
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

const UNFILED = "__unfiled__"

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
  const checked = freshness.lastCheckedAt
    ? `Reviews checked ${formatRelativeTime(freshness.lastCheckedAt)}`
    : "Reviews not checked yet"
  return (
    <span
      className={cn(
        "text-caption",
        freshness.state === "data_delayed"
          ? "text-warning-ink"
          : "text-ink-muted"
      )}
    >
      {freshness.state === "data_delayed"
        ? `${checked} · delayed, retrying`
        : checked}
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

/** The phone row's one-line Waiting figure (the pills show from 720px). */
function WaitingFigure({ summary }: { summary: ListingSummary | undefined }) {
  if (!summary) return <span className="text-ink-muted">—</span>
  const failed =
    summary.lastPublish?.status === "failed" || summary.posts.failed > 0
  const count = waitingCount(summary)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-secondary">
      {count > 0 ? (
        <span className="font-mono tabular-nums">
          {formatNumber(count)} waiting
        </span>
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
 * The phone row (the table's container under 720px): a compact record, not
 * a stack of labelled cells. The listing name is the headline with a
 * chevron, and one line under it carries the health pill and the waiting
 * figure; the client, verification and last-published columns step aside
 * (they are one tap away on the listing). The responsive table's own rules
 * select on `tbody > tr > td`, so these overrides are marked important.
 */
const PHONE = {
  rowSelectable:
    "@max-[720px]/table:grid-cols-[auto_auto_minmax(0,1fr)]! @max-[720px]/table:gap-y-1!",
  rowPlain: "@max-[720px]/table:grid-cols-[auto_minmax(0,1fr)]!",
  select:
    "@max-[720px]/table:col-span-1! @max-[720px]/table:row-span-2 @max-[720px]/table:self-center",
  /** The name spans every column right of the checkbox. */
  nameSelectable: "@max-[720px]/table:col-span-2!",
  hidden: "@max-[720px]/table:hidden!",
  /** Shown only on the phone row. */
  only: "hidden @max-[720px]/table:inline-flex",
  /** Shown only from 720px. */
  wide: "@max-[720px]/table:hidden",
} as const

/** The table's frame, shared by the loaded board and its skeleton. */
function BoardTable({
  children,
  busy = false,
  selectable = false,
}: {
  children: React.ReactNode
  busy?: boolean
  /** Owners and admins select listings for a bulk change. */
  selectable?: boolean
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
              <span className="sr-only">Select</span>
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

function BoardSkeleton() {
  const business = useWorkspaceMode() === "business"
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-full max-w-140 rounded-(--np-radius-pill)" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-(--np-control-h) w-full max-w-80" />
        <Skeleton className="h-(--np-control-h) w-full max-w-96 rounded-(--np-radius-control)" />
      </div>
      <Skeleton className="h-3.5 w-72 max-w-full" />
      <BoardTable busy>
        {[0, 1, 2, 3, 4].map((index) => (
          <TableRow key={index} aria-hidden>
            <TableCell>
              <Skeleton className="h-3.5 w-40 max-w-full" />
            </TableCell>
            {business ? null : (
              <TableCell>
                <Skeleton className="h-3.5 w-28" />
              </TableCell>
            )}
            <TableCell>
              <Skeleton className="h-5.5 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5.5 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5.5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </BoardTable>
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
 * waiting on which listing" without a single Google call. Below 720px of
 * width each row becomes a compact record (name, health, one waiting
 * figure, chevron) that is one tap target, and the filters are pressed
 * buttons throughout (client chips, health chips, order), so moving through
 * them by keyboard never re-filters the board.
 */
function ListingsBoard({
  role,
  bulkEnabled = false,
}: {
  role: string | null
  /** The organisation's `bulk_actions` feature; off hides bulk selection. */
  bulkEnabled?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "admin"
  const canSelect = canManage && bulkEnabled
  // Explicit listing ids for a bulk change. Filters only change what is shown;
  // the bulk preview freezes exactly these ids.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
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
  // not push, so Back leaves the board rather than undoing filters).
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

  const writeUrl = (next: {
    q?: string
    health?: HealthFilter
    clientId?: string | null
    order?: BoardOrder
  }) => {
    const params = new URLSearchParams(searchParams.toString())
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
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }
  const setSearch = (value: string) => {
    setSearchState(value)
    writeUrl({ q: value })
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

  if (directory.isPending) return <BoardSkeleton />
  // A failed background refetch keeps the board it already has.
  if (directory.isError && !directory.data) {
    return (
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
          tone="bad"
          icon={<CircleAlertIcon />}
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
      }),
      clientId: entry.clientId ?? UNFILED,
      clientName: entry.clientName ?? "Not filed under a client",
    }
  })

  if (rows.length === 0) {
    return (
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
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
      </div>
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
    const filing = row.clientId === UNFILED && canManage
    return (
      <TableRow
        key={row.entry.id}
        interactive
        className={cn(
          "relative",
          canSelect ? PHONE.rowSelectable : PHONE.rowPlain
        )}
      >
        {canSelect ? (
          <TableCell className={PHONE.select}>
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
        <TableCell
          className={cn(
            canSelect
              ? PHONE.nameSelectable
              : "@max-[720px]/table:col-span-full!"
          )}
        >
          <span className="flex min-w-0 items-start gap-2">
            <span className="flex min-w-0 flex-1 flex-col">
              {/* The whole row is this link's target: its ::after stretches
                  over the row (positioned), so a phone row is one tap and
                  never a 24px line of text. */}
              <Link
                href={listingHref(row.entry.id)}
                className="inline-flex min-h-(--np-control-h) items-center rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo after:absolute after:inset-0 after:content-[''] hover:underline @max-[720px]/table:text-body"
              >
                {row.entry.name}
              </Link>
              {address ? (
                <span className="text-caption break-words text-ink-muted">
                  {address}
                </span>
              ) : null}
            </span>
            <ChevronRightIcon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                PHONE.only,
                "mt-0.5 size-4 shrink-0 text-ink-muted"
              )}
            />
          </span>
        </TableCell>
        {business ? null : (
          <TableCell
            label={filing ? "Client" : undefined}
            span={filing}
            className={cn(
              filing ? "@max-[720px]/table:col-span-full!" : PHONE.hidden
            )}
          >
            {row.clientId === UNFILED ? (
              canManage ? (
                <span className="relative z-raised inline-flex max-w-full">
                  <FileUnderClient
                    locationId={row.entry.id}
                    locationName={row.entry.name}
                  />
                </span>
              ) : (
                <span className="text-ink-muted">Not filed</span>
              )
            ) : (
              <span className="flex min-w-0 items-center gap-2">
                <ClientAvatar name={row.clientName} colour={null} size="sm" />
                <span className="min-w-0 break-words">{row.clientName}</span>
              </span>
            )}
          </TableCell>
        )}
        <TableCell className="@max-[720px]/table:self-center">
          <span className="flex flex-col items-start gap-1">
            <StatusPill tone={listingHealthTone(row.health)}>
              {listingHealthLabel(row.health)}
            </StatusPill>
            <span className={PHONE.wide}>
              <FreshnessLine summary={row.summary} />
            </span>
          </span>
        </TableCell>
        <TableCell className="@max-[720px]/table:self-center">
          {summaries.isPending ? (
            <Skeleton className="h-5.5 w-32" />
          ) : quietRow(row.summary) ? (
            // One node at every width: a quiet row says so once, not once
            // per layout (the phone figure and the pills would repeat it).
            <span className="text-caption text-ink-muted @min-[720px]/table:text-ui">
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
        <TableCell className={PHONE.hidden}>
          <VerificationCell row={row} />
        </TableCell>
        <TableCell className={PHONE.hidden}>
          {summaries.isPending ? (
            <Skeleton className="h-3.5 w-20" />
          ) : (
            <span className="font-mono text-caption text-ink-muted tabular-nums">
              {/* No summary means we don't know, not that it never happened. */}
              {!row.summary
                ? "—"
                : row.summary.lastPublish
                  ? formatRelativeTime(row.summary.lastPublish.at)
                  : "Never"}
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
      <div className="flex min-w-0 flex-col gap-3">
        {clientChips.length > 1 ? (
          <ChipRow
            role="group"
            aria-label="Filter by client"
            className="-mx-5 px-5 md:mx-0 md:px-0.5"
          >
            <ToggleChip
              pressed={clientFilter === null}
              onClick={() => setClientFilter(null)}
              count={formatNumber(rows.length)}
            >
              All clients
            </ToggleChip>
            {clientChips.map((chip) => {
              const pressed = clientFilter === chip.id
              return (
                <ToggleChip
                  key={chip.id}
                  pressed={pressed}
                  onClick={() => setClientFilter(pressed ? null : chip.id)}
                >
                  {chip.id === UNFILED ? (
                    <CircleAlertIcon aria-hidden strokeWidth={1.75} />
                  ) : null}
                  <span className="max-w-64 truncate">{chip.name}</span>
                  <ChipCount>{formatNumber(chip.count)}</ChipCount>
                </ToggleChip>
              )
            })}
          </ChipRow>
        ) : null}
        <div
          role="search"
          aria-label="Filter listings"
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
        >
          <SearchInput
            aria-label="Search listings"
            placeholder={
              business ? "Search listings" : "Search listings or clients"
            }
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(event.target.value)
            }
            onClear={() => setSearch("")}
            className="w-full min-w-0 sm:w-auto sm:max-w-80 sm:shrink sm:grow sm:basis-55"
          />
          {business ? null : (
            // Pressed buttons, like the client chips: arrows move focus and
            // Enter/Space choose, so moving through the options never
            // re-filters the board or rewrites the address.
            <SegmentedControl
              semantics="toggle"
              aria-label="Order listings"
              className="max-w-full min-w-0"
              value={order}
              onValueChange={(next) => setOrder(next as BoardOrder)}
            >
              <SegmentedControlItem value="health" className="flex-none">
                Worst first
              </SegmentedControlItem>
              <SegmentedControlItem value="client" className="flex-none">
                By client
              </SegmentedControlItem>
            </SegmentedControl>
          )}
        </div>
        {/* Health is one more set of filter chips: five options never fit a
            phone's segmented track, so they wrap rather than hide behind a
            scroll, and every label and count stays visible. */}
        <div
          role="group"
          aria-label="Filter by health"
          className="flex min-w-0 flex-wrap gap-2"
        >
          {HEALTH_FILTERS.map((filter) => (
            <ToggleChip
              key={filter.value}
              pressed={health === filter.value}
              onClick={() => setHealth(filter.value)}
              count={formatNumber(healthCount(filter.value))}
            >
              {filter.label}
            </ToggleChip>
          ))}
        </div>
        <p className="text-caption text-ink-muted" aria-live="polite">
          {summaries.isPending ? (
            "Checking each listing…"
          ) : (
            <>
              <span className="font-mono tabular-nums">
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
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          <Empty
            icon={<FilterIcon />}
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
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {canSelect ? (
            // Not in the table header: the header hides under 720px, and
            // selecting what is shown must work on a phone too.
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 px-1">
              <Checkbox
                label={`Select all shown (${formatNumber(visible.length)})`}
                description={
                  selectAllBlocked
                    ? `One bulk change covers at most ${BULK_MAX_TARGETS} listings. Narrow the board or select listings one by one.`
                    : undefined
                }
                checked={allShownSelected}
                indeterminate={!allShownSelected && shownSelected > 0}
                disabled={selectAllBlocked}
                onCheckedChange={(checked) => setAllShown(checked === true)}
              />
            </div>
          ) : null}
          <BoardTable selectable={canSelect}>
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
