"use client"

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Building2Icon,
  CircleAlertIcon,
  FilterIcon,
  InfoIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { SearchInput } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import {
  clientHealthNote,
  connectionNeedsReconnect,
  HEALTH_FILTERS,
  healthFilterMatches,
  healthLabel,
  healthTone,
  isHealthFilter,
  type ClientHealth,
  type HealthFilter,
} from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format"
import {
  useArchivedClients,
  useClientMutations,
  useClients,
} from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

/**
 * The sections whose old addresses now land here (`?moved=<section>`), named
 * the way the notice says them. Anything else still gets the notice, just
 * without a name.
 */
const MOVED_SECTIONS: Record<string, string> = {
  profile: "Profile",
  photos: "Photos",
  posts: "Posts",
  hours: "Opening hours",
  menu: "Menu",
  menus: "Menu",
  reviews: "Reviews",
  locations: "Locations",
  listings: "Listings",
  performance: "Performance",
}

/** The notice for `?moved=`; null when the parameter is absent. */
export function movedNotice(section: string | null | undefined): string | null {
  if (section === null || section === undefined) return null
  const name = MOVED_SECTIONS[section.toLowerCase()]
  return name
    ? `${name} moved — pick a client, then its listing.`
    : "That page moved — pick a client, then its listing."
}

/**
 * Every client, ordered so the ones needing work come first.
 *
 * An agency opens this to answer "where do I go now", so the default order is
 * by open work rather than alphabetically: a name-sorted list makes the
 * operator read all forty rows to find the two that matter.
 *
 * Reference `clients.html`: four health tiles, a health filter and a name
 * search, then the table, which becomes labelled rows on a narrow screen
 * with health and the open-work link intact. The filter (`?health=`), the
 * search (`?q=`) and the Archived view (`?view=archived`) live in the
 * address, so a filtered list can be shared, reloaded and gone back to.
 */
function ClientsIndex({ role }: { role: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const canCreate = role === "owner" || role === "admin"
  const archivedView = canCreate && params?.get("view") === "archived"
  const clients = useClients()
  const archived = useArchivedClients(canCreate)

  const rawHealth = params?.get("health") ?? null
  const health: HealthFilter = isHealthFilter(rawHealth) ? rawHealth : "all"
  const urlQuery = params?.get("q") ?? ""
  // The field keeps its own value so typing never waits on navigation; the
  // address follows it, and a Back/Forward that changes `?q=` wins.
  const [query, setQueryState] = React.useState(urlQuery)
  const [syncedQuery, setSyncedQuery] = React.useState(urlQuery)
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery)
    setQueryState(urlQuery)
  }
  const moved = movedNotice(params?.get("moved"))

  const replaceParams = (mutate: (search: URLSearchParams) => void) => {
    const search = new URLSearchParams(params?.toString() ?? "")
    mutate(search)
    const qs = search.toString()
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? "/clients"), {
      scroll: false,
    })
  }
  const setHealth = (next: string) =>
    replaceParams((search) => {
      if (next === "all") search.delete("health")
      else search.set("health", next)
    })
  const setQuery = (next: string) => {
    setQueryState(next)
    setSyncedQuery(next)
    replaceParams((search) => {
      if (next.trim()) search.set("q", next)
      else search.delete("q")
    })
  }
  const setView = (next: "archived" | null) =>
    replaceParams((search) => {
      if (next) search.set("view", next)
      else search.delete("view")
    })
  const dismissMoved = () => replaceParams((search) => search.delete("moved"))

  const notice = moved ? (
    <Alert variant="info" icon={<InfoIcon strokeWidth={1.75} aria-hidden />}>
      <AlertTitle>{moved}</AlertTitle>
      <AlertActions>
        <Button variant="secondary" size="sm" onClick={dismissMoved}>
          Got it
        </Button>
      </AlertActions>
    </Alert>
  ) : null

  if (archivedView) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        {notice}
        <ArchivedClients
          query={archived}
          onBack={() => setView(null)}
          search={query}
          onSearch={setQuery}
        />
      </div>
    )
  }

  if (clients.isPending) return <ClientsSkeleton />

  if (clients.isError) {
    return (
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
          tone="bad"
          titleAs="h2"
          icon={<CircleAlertIcon />}
          title="We couldn't load your clients"
          description={`${describeActionError(clients.error)} Nothing was changed.`}
          action={
            <Button
              variant="secondary"
              pending={clients.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void clients.refetch()}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  const all = [...(clients.data?.items ?? [])].sort((a, b) => {
    const workA = a.openWork.needsReply + a.openWork.awaitingApproval
    const workB = b.openWork.needsReply + b.openWork.awaitingApproval
    if (workA !== workB) return workB - workA
    return a.name.localeCompare(b.name)
  })
  const unassigned = clients.data?.unassignedLocationCount ?? 0
  const archivedCount = archived.data?.items.length ?? 0
  const archivedLink =
    canCreate && archivedCount > 0 ? (
      <Button variant="ghost" size="sm" onClick={() => setView("archived")}>
        <ArchiveIcon aria-hidden strokeWidth={1.75} />
        Archived ({formatNumber(archivedCount)})
      </Button>
    ) : null

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        {notice}
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          {canCreate ? (
            <Empty
              titleAs="h2"
              icon={<Building2Icon />}
              title="Set up your first client"
              description="A client is a business you look after. Add one, then connect the Google account that manages its Business Profile."
              action={
                <>
                  <Link href="/clients/new" className={cn(buttonVariants())}>
                    <PlusIcon aria-hidden />
                    New client
                  </Link>
                  {archivedLink}
                </>
              }
            />
          ) : (
            <Empty
              titleAs="h2"
              icon={<LockIcon />}
              title="No clients shared with you yet"
              description="An owner or admin chooses which clients you can see. Once they share one, it appears here with its reviews and listings."
            />
          )}
        </div>
      </div>
    )
  }

  const needle = query.trim().toLowerCase()
  const rows = all
    .filter((client) => healthFilterMatches(health, client.health))
    .filter((client) => !needle || client.name.toLowerCase().includes(needle))
  const count = (filter: HealthFilter) =>
    all.filter((client) => healthFilterMatches(filter, client.health)).length
  const filterLabel =
    HEALTH_FILTERS.find((filter) => filter.value === health)?.label ?? "All"

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {notice}
      <HealthSummary clients={all} active={health} onSelect={setHealth} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={health}
          onValueChange={setHealth}
          aria-label="Filter by health"
          className="max-w-full"
        >
          {HEALTH_FILTERS.map((filter) => (
            <SegmentedControlItem
              key={filter.value}
              value={filter.value}
              className="flex-none"
            >
              {filter.label}
              <span className="font-mono text-[11px] font-medium text-ink-muted tabular-nums">
                {formatNumber(count(filter.value))}
              </span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <div role="search" className="w-full min-w-0 @min-[640px]:w-80">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter clients by name"
            aria-label="Filter clients by name"
          />
        </div>
      </div>

      <section
        aria-labelledby="clients-table-title"
        className="flex flex-col gap-2.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2
            id="clients-table-title"
            className="text-title font-semibold text-ink"
          >
            All clients
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p aria-live="polite" className="text-caption text-ink-muted">
              {formatNumber(rows.length)} of {formatNumber(all.length)}{" "}
              {all.length === 1 ? "client" : "clients"} · needing work first
            </p>
            {archivedLink}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-(--np-radius-card) border border-line bg-surface">
            <Empty
              titleAs="h3"
              tone={needle || health === "all" ? "neutral" : "ok"}
              icon={<FilterIcon />}
              title={
                needle
                  ? `No clients match “${query.trim()}”`
                  : `No clients in “${filterLabel}”`
              }
              description={
                needle
                  ? "Check the spelling, or clear the search to see every client."
                  : "No client is in this state right now. Clear the filter to see the rest."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    replaceParams((search) => {
                      setQueryState("")
                      setSyncedQuery("")
                      search.delete("q")
                      search.delete("health")
                    })
                  }
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : (
          <DataTable
            caption="Clients, with their Google health and open review work"
            rows={rows}
            rowId={(client) => client.id}
            onRowClick={(client) => router.push(`/clients/${client.id}`)}
            surface
            responsive
            columns={[
              {
                id: "name",
                header: "Client",
                span: true,
                label: "",
                cell: (client) => (
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ClientAvatar name={client.name} colour={client.colour} />
                    <span className="flex min-w-0 flex-col">
                      <Link
                        href={`/clients/${client.id}`}
                        className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {client.name}
                      </Link>
                      <span className="text-caption text-ink-muted">
                        {client.locationCount === 0
                          ? "No listings"
                          : `${formatNumber(client.locationCount)} ${client.locationCount === 1 ? "listing" : "listings"}`}
                      </span>
                    </span>
                  </span>
                ),
              },
              {
                id: "health",
                header: "Health",
                cell: (client) => {
                  const note = clientHealthNote(client)
                  return (
                    <span className="flex flex-col items-start gap-1">
                      <StatusPill
                        tone={healthTone(client.health)}
                        dashed={client.health === "not_connected"}
                      >
                        {healthLabel(client.health)}
                      </StatusPill>
                      {note ? (
                        <span className="text-caption text-ink-muted">
                          {note}
                        </span>
                      ) : null}
                    </span>
                  )
                },
              },
              {
                id: "locations",
                header: "Listings linked",
                numeric: true,
                cell: (client) => (
                  <span>
                    {formatNumber(client.linkedCount)}
                    <span className="text-ink-muted">
                      {" / "}
                      {formatNumber(client.locationCount)}
                    </span>
                  </span>
                ),
              },
              {
                id: "work",
                header: "Open reviews",
                numeric: true,
                cell: (client) => <OpenWork client={client} />,
              },
              {
                id: "sync",
                header: "Last sync",
                cell: (client) => (
                  <span
                    className={cn(
                      "text-ui",
                      client.health === "disconnected"
                        ? "text-danger-ink"
                        : "text-ink-muted"
                    )}
                  >
                    {client.lastSyncAt
                      ? formatRelativeTime(client.lastSyncAt)
                      : "Not yet"}
                  </span>
                ),
              },
              {
                id: "login",
                header: "Google login",
                span: true,
                cell: (client) => <LoginCell client={client} />,
              },
            ]}
          />
        )}
      </section>

      {unassigned > 0 && canCreate ? (
        <Alert icon={<MapPinIcon strokeWidth={1.75} aria-hidden />}>
          <AlertTitle>
            {unassigned === 1
              ? "1 listing has no client"
              : `${formatNumber(unassigned)} listings have no client`}
          </AlertTitle>
          <AlertDescription>
            Imported from Google but not yet filed under a client. They stay out
            of client filters and reports until you file them.
          </AlertDescription>
          <AlertActions>
            <Link
              href="/listings"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Open Listings
            </Link>
          </AlertActions>
        </Alert>
      ) : null}
    </div>
  )
}

/**
 * The four health buckets, in the same words as the filter and the pills.
 * They do not overlap, so they add up to every client, and each tile is the
 * filter: pressing one shows exactly the clients it counted.
 */
const SUMMARY_TILES: Array<{
  filter: Exclude<HealthFilter, "all">
  health: ClientHealth
}> = [
  { filter: "disconnected", health: "disconnected" },
  { filter: "attention", health: "attention" },
  { filter: "healthy", health: "healthy" },
  { filter: "not_connected", health: "not_connected" },
]

function HealthSummary({
  clients,
  active,
  onSelect,
}: {
  clients: ClientSummary[]
  active: HealthFilter
  onSelect: (filter: HealthFilter) => void
}) {
  const importing = clients.filter((c) => c.health === "syncing").length
  return (
    <section
      aria-label="Health summary"
      className="grid grid-cols-2 gap-3 @min-[760px]:grid-cols-4"
    >
      {SUMMARY_TILES.map((tile) => {
        const value = clients.filter((c) =>
          healthFilterMatches(tile.filter, c.health)
        ).length
        const pressed = active === tile.filter
        return (
          <button
            key={tile.filter}
            type="button"
            aria-pressed={pressed}
            // Pressing the shown filter again clears it.
            onClick={() => onSelect(pressed ? "all" : tile.filter)}
            className={cn(
              "flex min-w-0 flex-col gap-0.5 rounded-(--np-radius-card) border bg-surface px-3.5 py-3 text-left focus-halo transition-[border-color,box-shadow] duration-(--np-duration-fast) hover:border-line-strong",
              pressed ? "border-primary shadow-np-raised" : "border-line"
            )}
          >
            <span className="font-mono text-[22px] leading-7 font-semibold text-ink tabular-nums">
              {formatNumber(value)}
            </span>
            <span className="flex items-baseline gap-1.5 text-ui text-ink-muted">
              <span className="shrink-0 translate-y-[-1px]">
                <StatusPill
                  variant="dot"
                  tone={healthTone(tile.health)}
                  dashed={tile.health === "not_connected"}
                />
              </span>
              {healthLabel(tile.health)}
            </span>
            {tile.filter === "healthy" && importing > 0 ? (
              <span className="text-caption text-ink-muted">
                {formatNumber(importing)} importing
              </span>
            ) : null}
          </button>
        )
      })}
    </section>
  )
}

/**
 * Archived clients, each with Restore. Archiving hides a client everywhere
 * else, so this is the one place to find it again.
 */
function ArchivedClients({
  query,
  onBack,
  search,
  onSearch,
}: {
  query: ReturnType<typeof useArchivedClients>
  onBack: () => void
  search: string
  onSearch: (next: string) => void
}) {
  const { update } = useClientMutations()
  const toast = useToastManager()
  const [restoring, setRestoring] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const restore = async (client: ClientSummary) => {
    setRestoring(client.id)
    setError(null)
    try {
      await update.mutateAsync({ clientId: client.id, archived: false })
      toast.add({
        type: "success",
        title: `${client.name} restored`,
        description:
          "It’s back in your lists. File its listings again from its settings.",
      })
    } catch (cause) {
      setError(`${client.name} wasn’t restored. ${describeActionError(cause)}`)
    } finally {
      setRestoring(null)
    }
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title font-semibold text-ink">Archived clients</h2>
        <p className="text-caption text-ink-muted">
          Hidden from lists, filters and reports. Restore one to bring it back.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onBack}>
        Back to all clients
      </Button>
    </div>
  )

  if (query.isPending) {
    return (
      <section className="flex flex-col gap-3" aria-busy="true">
        {header}
        <p role="status" className="text-ui text-ink-muted">
          Loading archived clients…
        </p>
        <Skeleton className="h-32 rounded-(--np-radius-card)" />
      </section>
    )
  }
  if (query.isError) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load archived clients</AlertTitle>
          <AlertDescription>
            {describeActionError(query.error)} Nothing was changed.
          </AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              size="sm"
              pending={query.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </AlertActions>
        </Alert>
      </section>
    )
  }

  const needle = search.trim().toLowerCase()
  const items = (query.data?.items ?? []).filter(
    (client) => !needle || client.name.toLowerCase().includes(needle)
  )

  return (
    <section className="flex flex-col gap-3" aria-label="Archived clients">
      {header}
      <div role="search" className="w-full min-w-0 @min-[640px]:w-80">
        <SearchInput
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Filter archived clients"
          aria-label="Filter archived clients by name"
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>That didn’t work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          <Empty
            titleAs="h3"
            icon={<ArchiveIcon />}
            title={
              needle
                ? `No archived clients match “${search.trim()}”`
                : "Nothing archived"
            }
            description={
              needle
                ? "Clear the search to see every archived client."
                : "Clients you archive appear here, ready to restore."
            }
          />
        </div>
      ) : (
        <DataTable
          caption="Archived clients, with when each was archived"
          rows={items}
          rowId={(client) => client.id}
          surface
          responsive
          columns={[
            {
              id: "name",
              header: "Client",
              span: true,
              label: "",
              cell: (client) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  <ClientAvatar name={client.name} colour={client.colour} />
                  <span className="font-semibold break-words text-ink">
                    {client.name}
                  </span>
                </span>
              ),
            },
            {
              id: "archived",
              header: "Archived",
              cell: (client) => (
                <span className="text-ui text-ink-muted">
                  {client.archivedAt
                    ? formatDate(client.archivedAt, "Europe/London")
                    : "—"}
                </span>
              ),
            },
            {
              id: "restore",
              header: <span className="sr-only">Actions</span>,
              label: "",
              className: "text-right",
              cell: (client) => (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Restore ${client.name}`}
                  pending={restoring === client.id}
                  pendingLabel="Restoring…"
                  disabled={restoring !== null && restoring !== client.id}
                  onClick={() => void restore(client)}
                >
                  <ArchiveRestoreIcon aria-hidden strokeWidth={1.75} />
                  Restore
                </Button>
              ),
            },
          ]}
        />
      )}
    </section>
  )
}

function OpenWork({ client }: { client: ClientSummary }) {
  const { needsReply, awaitingApproval, failed } = client.openWork
  if (needsReply + awaitingApproval + failed === 0) {
    return <span className="text-ink-muted">Clear</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 tabular-nums">
      {needsReply > 0 ? (
        <Link
          href={`/inbox?clientId=${client.id}`}
          onClick={(event) => event.stopPropagation()}
          className="rounded-(--np-radius-tag) font-medium text-ink underline underline-offset-3 focus-halo hover:decoration-2 pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"
        >
          {formatNumber(needsReply)} to reply
        </Link>
      ) : null}
      {awaitingApproval > 0 ? (
        <span className="text-ink-muted">
          {needsReply > 0 ? "· " : ""}
          {formatNumber(awaitingApproval)} approval
        </span>
      ) : null}
      {failed > 0 ? (
        <StatusPill tone="bad">{formatNumber(failed)} failed</StatusPill>
      ) : null}
    </span>
  )
}

/** The Google login(s) behind a client, from its real connections. */
function LoginCell({ client }: { client: ClientSummary }) {
  const [first, ...rest] = client.connections
  if (!first) {
    return <span className="text-ui text-ink-muted">No Google login yet</span>
  }
  // The same rule as the health word: an expired access token refreshes on
  // its own and is not a login someone has to reconnect.
  const broken = client.connections.filter(connectionNeedsReconnect).length
  return (
    <span className="flex min-w-0 flex-col text-ui">
      <span className="[overflow-wrap:anywhere] text-ink">
        {first.googleEmail ?? "Google account"}
      </span>
      <span className="text-caption text-ink-muted">
        {rest.length > 0 ? `+${formatNumber(rest.length)} more` : null}
        {rest.length > 0 && broken > 0 ? " · " : null}
        {broken > 0 ? (
          <span className="font-medium text-danger-ink">
            {broken === client.connections.length
              ? "needs reconnecting"
              : `${formatNumber(broken)} needs reconnecting`}
          </span>
        ) : null}
      </span>
    </span>
  )
}

/**
 * The index's loading shape: four tiles, a line saying what is loading, and
 * the list card. Exported so the route's `loading.tsx` draws exactly this
 * instead of a copy that drifted.
 */
function ClientsSkeleton() {
  return (
    <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 @min-[760px]:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface px-3.5 py-3"
          >
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ))}
      </div>
      <p role="status" className="text-ui text-ink-muted">
        Loading clients…
      </p>
      <div className="divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="flex h-(--np-row-h) items-center gap-3 px-(--np-cell-px)"
          >
            <Skeleton className="size-8 rounded-(--np-radius-control)" />
            <Skeleton className="h-3.5 w-40 max-w-[40%]" />
            <Skeleton className="ml-auto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

function NewClientButton() {
  return (
    <Link href="/clients/new" className={cn(buttonVariants())}>
      <PlusIcon aria-hidden strokeWidth={1.75} />
      New client
    </Link>
  )
}

export { ClientsIndex, ClientsSkeleton, NewClientButton }
