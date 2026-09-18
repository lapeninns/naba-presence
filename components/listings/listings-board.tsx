"use client"

import { PlusIcon, StoreIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { Button, buttonVariants } from "@/components/ui/button"
import { ToggleChip } from "@/components/ui/chip"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { SearchInput } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
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

const HEALTH_FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "unpublished", label: "To publish" },
  { value: "not_linked", label: "Not linked" },
  { value: "healthy", label: "In sync" },
] as const
type HealthFilter = (typeof HEALTH_FILTERS)[number]["value"]

const UNFILED = "__unfiled__"

type BoardRow = {
  entry: DirectoryEntry
  summary: ListingSummary | undefined
  health: ListingHealth
  clientId: string
  clientName: string
}

function matchesHealth(health: ListingHealth, filter: HealthFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "attention":
      return health === "attention" || health === "disconnected"
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
  attention: 1,
  unpublished: 2,
  pending_verification: 3,
  not_linked: 4,
  healthy: 5,
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
          : `${summary.posts.awaitingApproval} posts awaiting approval`,
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

function BoardSkeleton() {
  return (
    <div
      aria-busy="true"
      className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex h-(--np-row-h) items-center gap-3 px-(--np-cell-px)"
        >
          <Skeleton className="size-2 rounded-(--np-radius-pill)" />
          <Skeleton className="h-3.5 w-48 max-w-[40%]" />
          <Skeleton className="ml-auto h-5 w-24 rounded-(--np-radius-pill)" />
        </div>
      ))}
    </div>
  )
}

/**
 * Every listing the session can see, health first.
 *
 * Grouped by client with the unfiled ones on top, because that is where a
 * newly linked listing lands and the one thing it needs is a client. The
 * Pending column reads the DB-only summary, so the board answers "what is
 * waiting on which listing" without a single Google call.
 */
function ListingsBoard({ role }: { role: string | null }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)
  const clients = useClients()
  const summaries = useListingSummaries()

  const [search, setSearch] = React.useState("")
  const [health, setHealth] = React.useState<HealthFilter>("all")
  const initialClient = searchParams.get("clientId")
  const [clientFilter, setClientFilter] = React.useState<string | null>(
    initialClient
  )

  if (directory.isPending) return <BoardSkeleton />
  if (directory.isError) {
    return (
      <Empty
        title="We couldn't load your listings"
        description="Something went wrong reaching the server."
        action={
          <Button variant="outline" onClick={() => void directory.refetch()}>
            Try again
          </Button>
        }
      />
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
      <Empty
        icon={<StoreIcon />}
        title="No listings yet"
        description={
          canManage
            ? "Connect a client's Google account and link its locations, and they appear here."
            : "Nothing is linked to Google yet. An owner or admin can add the first listing."
        }
        action={
          canManage ? (
            <Link href="/setup" className={buttonVariants({ pill: true })}>
              <PlusIcon aria-hidden strokeWidth={1.75} />
              Add listings from Google
            </Link>
          ) : undefined
        }
      />
    )
  }

  const needle = search.trim().toLowerCase()
  const visible = rows
    .filter((row) => (clientFilter ? row.clientId === clientFilter : true))
    .filter((row) => matchesHealth(row.health, health))
    .filter((row) =>
      needle
        ? row.entry.name.toLowerCase().includes(needle) ||
          row.clientName.toLowerCase().includes(needle)
        : true
    )
    .sort((a, b) => {
      // Unfiled first, then worst health, then name.
      if ((a.clientId === UNFILED) !== (b.clientId === UNFILED))
        return a.clientId === UNFILED ? -1 : 1
      if (a.clientId !== b.clientId)
        return a.clientName.localeCompare(b.clientName)
      const order = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]
      return order !== 0 ? order : a.entry.name.localeCompare(b.entry.name)
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

  return (
    <div className="flex flex-col gap-(--np-gap-card)">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            aria-label="Search listings"
            placeholder="Search listings"
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(event.target.value)
            }
            onClear={() => setSearch("")}
            className="w-full sm:w-64"
          />
          <SegmentedControl
            aria-label="Filter by health"
            size="sm"
            value={health}
            onValueChange={(next) => setHealth(next as HealthFilter)}
            className="-mx-5 max-w-[calc(100%+2.5rem)] overflow-x-auto px-5 sm:mx-0 sm:max-w-none sm:px-0"
          >
            {HEALTH_FILTERS.map((filter) => (
              <SegmentedControlItem key={filter.value} value={filter.value}>
                {filter.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        {clientChips.length > 1 ? (
          <div
            role="group"
            aria-label="Filter by client"
            className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 py-0.5 md:-mx-(--np-page-pad-x) md:px-(--np-page-pad-x)"
          >
            {clientChips.map((chip) => {
              const pressed = clientFilter === chip.id
              return (
                <ToggleChip
                  key={chip.id}
                  pressed={pressed}
                  onClick={() => setClientFilter(pressed ? null : chip.id)}
                >
                  <span className="truncate">{chip.name}</span>
                  <span
                    className={
                      pressed
                        ? "text-primary-foreground/80 tabular-nums"
                        : "text-ink-muted tabular-nums"
                    }
                  >
                    {formatNumber(chip.count)}
                  </span>
                </ToggleChip>
              )
            })}
          </div>
        ) : null}
        <p className="text-caption text-ink-muted" aria-live="polite">
          {summaries.isPending
            ? "Checking each listing…"
            : summariseListingHealth(rows.map((row) => row.health))}
        </p>
      </div>

      <DataTable
        caption="Listings, with their Google health and what is waiting on each"
        rows={visible}
        rowId={(row) => row.entry.id}
        onRowClick={(row) => router.push(listingHref(row.entry.id))}
        density="compact"
        surface
        empty={
          <Empty
            title="No listings match"
            description="Try another client, health or search."
            className="py-8"
          />
        }
        columns={[
          {
            id: "listing",
            header: "Listing",
            cell: (row) => {
              const address = formatAddressLine(row.entry.address)
              return (
                <span className="flex min-w-0 flex-col">
                  <Link
                    href={listingHref(row.entry.id)}
                    className="truncate rounded-(--np-radius-tag) font-medium text-ink underline-offset-4 focus-halo hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.entry.name}
                  </Link>
                  {address ? (
                    <span className="truncate text-caption text-ink-muted">
                      {address}
                    </span>
                  ) : null}
                </span>
              )
            },
          },
          {
            id: "client",
            header: "Client",
            cell: (row) =>
              row.clientId === UNFILED ? (
                canManage ? (
                  <FileUnderClient
                    locationId={row.entry.id}
                    locationName={row.entry.name}
                  />
                ) : (
                  <span className="text-ink-muted">Not filed</span>
                )
              ) : (
                <span className="flex items-center gap-2">
                  <ClientAvatar name={row.clientName} colour={null} size="sm" />
                  <span className="truncate">{row.clientName}</span>
                </span>
              ),
          },
          {
            id: "health",
            header: "Health",
            cell: (row) => (
              <StatusPill variant="inline" tone={listingHealthTone(row.health)}>
                {listingHealthLabel(row.health)}
              </StatusPill>
            ),
          },
          {
            id: "pending",
            header: "Waiting",
            cell: (row) =>
              summaries.isPending ? (
                <Skeleton className="h-4 w-28" />
              ) : (
                <PendingChips summary={row.summary} />
              ),
          },
          {
            id: "published",
            header: "Last published",
            cell: (row) => (
              <span className="text-caption text-ink-muted">
                {row.summary?.lastPublish
                  ? formatRelativeTime(row.summary.lastPublish.at)
                  : "Never"}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}

export { ListingsBoard }
