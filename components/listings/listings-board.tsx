"use client"

import {
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
import { Button, buttonVariants } from "@/components/ui/button"
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
import { listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import { useClients } from "@/lib/queries/use-clients"
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
        freshness.state === "data_delayed" ? "text-warning-ink" : "text-ink-muted"
      )}
    >
      {freshness.state === "data_delayed" ? `${checked} · delayed, retrying` : checked}
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

/** The table's frame, shared by the loaded board and its skeleton. */
function BoardTable({
  children,
  busy = false,
}: {
  children: React.ReactNode
  busy?: boolean
}) {
  return (
    <Table surface responsive aria-busy={busy || undefined}>
      <caption className="sr-only">
        Listings, with their Google health and what is waiting on each
      </caption>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-full max-w-[560px] rounded-(--np-radius-pill)" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-(--np-control-h) w-full max-w-80" />
        <Skeleton className="h-9 w-full max-w-96 rounded-[10px]" />
      </div>
      <Skeleton className="h-3.5 w-72 max-w-full" />
      <BoardTable busy>
        {[0, 1, 2, 3, 4].map((index) => (
          <TableRow key={index} aria-hidden>
            <TableCell>
              <Skeleton className="h-3.5 w-40 max-w-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-[22px] w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-[22px] w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-[22px] w-20" />
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
 * width each row becomes a labelled card that keeps its health, its counts
 * and the listing link that opens it.
 */
function ListingsBoard({ role }: { role: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)
  const clients = useClients()
  const summaries = useListingSummaries()

  // Local state answers each keystroke at once; the URL follows it (replace,
  // not push, so Back leaves the board rather than undoing filters).
  const [search, setSearchState] = React.useState(
    () => searchParams.get("q") ?? ""
  )
  const [health, setHealthState] = React.useState<HealthFilter>(() => {
    const value = searchParams.get("health")
    return isHealthFilter(value) ? value : "all"
  })
  const [clientFilter, setClientState] = React.useState<string | null>(
    () => searchParams.get("clientId")
  )
  const [order, setOrderState] = React.useState<BoardOrder>(() =>
    searchParams.get("order") === "client" ? "client" : "health"
  )

  const writeUrl = (next: {
    q?: string
    health?: HealthFilter
    clientId?: string | null
    order?: BoardOrder
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    const set = (key: string, value: string | null | undefined, empty: string) => {
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
              ? "Connect a client’s Google login and link its locations, and they appear here with their health."
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
          row.clientName.toLowerCase().includes(needle)
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

  const clientChips = [
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

  const grouped = order === "client"
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

  const renderRow = (row: BoardRow) => {
    const address = formatAddressLine(row.entry.address)
    return (
      <TableRow
        key={row.entry.id}
        interactive
        onClick={() => router.push(listingHref(row.entry.id))}
      >
        <TableCell label="Listing">
          <span className="flex min-w-0 flex-col">
            <Link
              href={listingHref(row.entry.id)}
              className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.entry.name}
            </Link>
            {address ? (
              <span className="text-caption break-words text-ink-muted">
                {address}
              </span>
            ) : null}
          </span>
        </TableCell>
        <TableCell
          label="Client"
          span={row.clientId === UNFILED && canManage}
          onClick={(event) => event.stopPropagation()}
        >
          {row.clientId === UNFILED ? (
            canManage ? (
              <FileUnderClient
                locationId={row.entry.id}
                locationName={row.entry.name}
              />
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
        <TableCell label="Health">
          <span className="flex flex-col items-start gap-1">
            <StatusPill tone={listingHealthTone(row.health)}>
              {listingHealthLabel(row.health)}
            </StatusPill>
            <FreshnessLine summary={row.summary} />
          </span>
        </TableCell>
        <TableCell label="Waiting" span>
          {summaries.isPending ? (
            <Skeleton className="h-[22px] w-32" />
          ) : (
            <PendingChips summary={row.summary} />
          )}
        </TableCell>
        <TableCell label="Verification">
          <VerificationCell row={row} />
        </TableCell>
        <TableCell label="Last published">
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
                  <span className="max-w-[16rem] truncate">{chip.name}</span>
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
            placeholder="Search listings or clients"
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(event.target.value)
            }
            onClear={() => setSearch("")}
            className="w-full min-w-0 sm:w-auto sm:max-w-80 sm:flex-[1_1_220px]"
          />
          <SegmentedControl
            aria-label="Filter by health"
            className="max-w-full min-w-0"
            value={health}
            onValueChange={(next) => setHealth(next as HealthFilter)}
          >
            {HEALTH_FILTERS.map((filter) => (
              <SegmentedControlItem
                key={filter.value}
                value={filter.value}
                className="flex-none"
              >
                {filter.label}
                <ChipCount>
                  {formatNumber(
                    inScope.filter((row) =>
                      matchesHealth(row.health, filter.value)
                    ).length
                  )}
                </ChipCount>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <SegmentedControl
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
            description="Nothing fits this client, health and search together. Widen one of them to see the rest."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <BoardTable>
          {unfiled.length > 0 ? (
            <TableRow group>
              <TableCell colSpan={COLUMNS.length}>
                Not filed under a client · {formatNumber(unfiled.length)}
              </TableCell>
            </TableRow>
          ) : null}
          {unfiled.map(renderRow)}
          {unfiled.length > 0 && filed.length > 0 ? (
            <TableRow group>
              <TableCell colSpan={COLUMNS.length}>
                Filed under a client · {formatNumber(filed.length)}
              </TableCell>
            </TableRow>
          ) : null}
          {filed.map(renderRow)}
        </BoardTable>
      )}
    </div>
  )
}

export { ListingsBoard }
