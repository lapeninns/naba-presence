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

import { ShellLink } from "@/components/app-shell/shell-link"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { useDebouncedSearchParam } from "@/components/clients/clients-index-search"
import {
  HealthFilterStrip,
  healthCounts,
} from "@/components/clients/health-filter"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { SearchInput } from "@/components/ui/input"
import { QueryError } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import {
  clientHealthNote,
  compareClientsByNeed,
  connectionNeedsReconnect,
  HEALTH_FILTERS,
  healthBucket,
  healthLabel,
  healthTone,
  isHealthFilter,
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
 * by need rather than alphabetically (`compareClientsByNeed`: health
 * severity, then open work, then name): a name-sorted list makes the operator
 * read all forty rows to find the two that matter.
 *
 * One health filter (a chip strip covering every bucket, with counts) and a
 * name search, then the list: record cards on a phone, the table on a wider
 * screen, both rendered and chosen in CSS. The filter (`?health=`), the
 * search (`?q=`, written once typing pauses) and the Archived view
 * (`?view=archived`) live in the address, so a filtered list can be shared,
 * reloaded and gone back to.
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
  const moved = movedNotice(params?.get("moved"))

  const replaceParams = (mutate: (search: URLSearchParams) => void) => {
    const search = new URLSearchParams(params?.toString() ?? "")
    mutate(search)
    const qs = search.toString()
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? "/clients"), {
      scroll: false,
    })
  }
  const putQuery = (search: URLSearchParams, next: string) => {
    if (next.trim()) search.set("q", next)
    else search.delete("q")
  }
  // The field keeps its own value so typing never waits on navigation; the
  // address follows once typing pauses (or on Enter / leaving the field),
  // and a Back/Forward that changes `?q=` wins.
  const searchField = useDebouncedSearchParam(urlQuery, (next) =>
    replaceParams((search) => putQuery(search, next))
  )
  const query = searchField.draft
  const searchProps = {
    value: query,
    enterKeyHint: "search" as const,
    autoComplete: "off",
    autoCapitalize: "none",
    spellCheck: false,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      searchField.setDraft(event.target.value),
    onBlur: searchField.flush,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") searchField.flush()
    },
  }
  const setHealth = (next: HealthFilter) =>
    replaceParams((search) => {
      if (next === "all") search.delete("health")
      else search.set("health", next)
      // A pending search goes in the same write, so the two never race.
      putQuery(search, searchField.take())
    })
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
          searchProps={searchProps}
        />
      </div>
    )
  }

  if (clients.isPending) return <ClientsSkeleton />

  if (clients.isError) {
    return (
      <Card flush>
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
      </Card>
    )
  }

  const all = [...(clients.data?.items ?? [])].sort(compareClientsByNeed)
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
        <Card flush>
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
        </Card>
      </div>
    )
  }

  const needle = query.trim().toLowerCase()
  // Filtered with the same bucket function the chips count with, so a
  // chip's count is exactly the clients it shows.
  const rows = all
    .filter(
      (client) => health === "all" || healthBucket(client.health) === health
    )
    .filter((client) => !needle || client.name.toLowerCase().includes(needle))
  const counts = healthCounts(all)
  const filterLabel =
    HEALTH_FILTERS.find((filter) => filter.value === health)?.label ?? "All"

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {notice}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 md:flex-1">
          <HealthFilterStrip
            value={health}
            counts={counts}
            onValueChange={setHealth}
          />
        </div>
        <div role="search" className="w-full min-w-0 md:w-80 md:flex-none">
          <SearchInput
            {...searchProps}
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
          <Card flush>
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
                  onClick={() => {
                    searchField.clear()
                    replaceParams((search) => {
                      search.delete("q")
                      search.delete("health")
                    })
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </Card>
        ) : (
          // One table for every width. Below 48rem of its own width each
          // row is a record card: avatar and name as the headline, the open
          // work trailing, the health word (and what is wrong) as the
          // subtitle, linked listings and the last sync on one meta line,
          // and a chevron. A tap anywhere on the card opens the client
          // (onRowClick); keyboard and screen-reader users open it through
          // the name link, whose name is just the client's.
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
                priority: "primary",
                cell: (client) => (
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ClientAvatar name={client.name} colour={client.colour} />
                    <span className="flex min-w-0 flex-col">
                      <ShellLink
                        href={`/clients/${client.id}`}
                        className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {client.name}
                      </ShellLink>
                      {/* A card says this in its meta line. */}
                      <span className="text-caption text-ink-muted @max-3xl/table:hidden">
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
                priority: "secondary",
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
                priority: "meta",
                label: "Linked",
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
                priority: "trailing",
                numeric: true,
                cell: (client) => <OpenWork client={client} />,
              },
              {
                id: "sync",
                header: "Last sync",
                priority: "meta",
                label: "Synced",
                cell: (client) => (
                  <span
                    className={
                      client.health === "disconnected"
                        ? "text-danger-ink"
                        : "text-ink-muted"
                    }
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
                // A card carries the broken login in its health note.
                priority: "desk-only",
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
 * Archived clients, each with Restore. Archiving hides a client everywhere
 * else, so this is the one place to find it again.
 */
function ArchivedClients({
  query,
  onBack,
  search,
  searchProps,
}: {
  query: ReturnType<typeof useArchivedClients>
  onBack: () => void
  search: string
  /** The shared, debounced `?q=` field wiring from the index. */
  searchProps: React.ComponentProps<typeof SearchInput>
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
        <QueryError
          title="We couldn’t load archived clients"
          description={`${describeActionError(query.error)} Nothing was changed.`}
          onRetry={() => void query.refetch()}
        />
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
      <div role="search" className="w-full min-w-0 md:w-80">
        <SearchInput
          {...searchProps}
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
        <Card flush>
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
        </Card>
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
              priority: "primary",
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
              priority: "meta",
              cell: (client) => (
                <span className="text-ink-muted">
                  {client.archivedAt
                    ? formatDate(client.archivedAt, "Europe/London")
                    : "—"}
                </span>
              ),
            },
            {
              id: "restore",
              header: <span className="sr-only">Actions</span>,
              priority: "actions",
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
        <ShellLink
          href={`/inbox?clientId=${client.id}`}
          onClick={(event) => event.stopPropagation()}
          className="rounded-(--np-radius-tag) font-medium text-ink underline underline-offset-3 focus-halo hover:decoration-2 pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"
        >
          {formatNumber(needsReply)} to reply
        </ShellLink>
      ) : null}
      {awaitingApproval > 0 ? (
        <span className="text-ink-muted">
          {needsReply > 0 ? "· " : ""}
          {formatNumber(awaitingApproval)} approval
        </span>
      ) : null}
      {failed > 0 ? (
        <StatusPill tone="at-risk">{formatNumber(failed)} failed</StatusPill>
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
 * The index's loading shape, drawn to the loaded page's measures so nothing
 * jumps on swap: the chip strip and search, the list heading with a line
 * saying what is loading, then record cards on a phone and table rows on a
 * wider screen (the record-card switch the table makes in CSS). Exported so the route's
 * `loading.tsx` draws exactly this instead of a copy that drifted.
 */
function ClientsSkeleton() {
  return (
    <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
      <div
        aria-hidden
        className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex min-w-0 gap-2 overflow-hidden md:flex-1">
          {["w-16", "w-36", "w-40", "w-24", "w-32"].map((width) => (
            <Skeleton
              key={width}
              className={cn(
                "h-8 shrink-0 rounded-(--np-radius-pill) pointer-coarse:h-10",
                width
              )}
            />
          ))}
        </div>
        <Skeleton className="h-(--np-field-h) w-full rounded-(--np-radius-control) md:w-80 md:flex-none" />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Skeleton aria-hidden className="h-6 w-28" />
          <p role="status" className="text-caption text-ink-muted">
            Loading clients…
          </p>
        </div>
        <Card flush aria-hidden className="md:hidden">
          <div className="divide-y divide-line">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 shrink-0 rounded-(--np-radius-control)" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Skeleton className="h-6 w-40 max-w-full" />
                  <Skeleton className="h-5.5 w-20 rounded-(--np-radius-tag)" />
                  <Skeleton className="h-4.5 w-48 max-w-full" />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Skeleton className="h-6 w-6" />
                  <Skeleton className="h-4.5 w-20" />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card flush aria-hidden className="max-md:hidden">
          <div className="divide-y divide-line">
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="flex h-(--np-row-h) items-center gap-3 px-(--np-cell-px)"
              >
                <Skeleton className="size-8 rounded-(--np-radius-control)" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="ml-auto h-3.5 w-16" />
              </div>
            ))}
          </div>
        </Card>
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
