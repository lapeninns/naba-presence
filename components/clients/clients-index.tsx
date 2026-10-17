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
import {
  QuickLookFact,
  QuickLookFacts,
  QuickLookPanel,
  QuickLookSection,
  useQuickLook,
} from "@/components/ui/quick-look-panel"
import { RelativeTime } from "@/components/ui/relative-time"
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
import { formatDate, formatNumber } from "@/lib/format"
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
 * The list's search field as a pill on the secondary fill (the Notion Mail
 * search), at the 44px touch height on a phone.
 */
const SEARCH_PILL =
  "rounded-(--np-radius-pill) border-transparent bg-fill-secondary max-md:h-(--np-touch)"

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
  // From `lg` a row click answers "what is waiting here?" in a side panel;
  // the name link still opens the client (DSK-23).
  const quick = useQuickLook<ClientSummary>()

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
          description={
            <span className="text-caption">
              {`${describeActionError(clients.error)} Nothing was changed.`}
            </span>
          }
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
              description={
                <span className="text-caption">
                  A client is a business you look after. Add one, then connect
                  the Google account that manages its Business Profile.
                </span>
              }
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
              description={
                <span className="text-caption">
                  An owner or admin chooses which clients you can see. Once they
                  share one, it appears here with its reviews and listings.
                </span>
              }
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

      {/* Search on its own row (the quickest way to one client), then the
          health chips beneath it: the same two rows at every width, so the
          chips have the full width to wrap in at the desk and a phone's strip
          still runs edge to edge. One order for reading and Tab. */}
      <div className="flex flex-col gap-2 md:gap-3">
        <div role="search" className="w-full min-w-0 md:w-80">
          <SearchInput
            {...searchProps}
            className={SEARCH_PILL}
            placeholder="Filter clients by name"
            aria-label="Filter clients by name"
          />
        </div>
        <HealthFilterStrip
          value={health}
          counts={counts}
          onValueChange={setHealth}
        />
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
                <span className="text-caption">
                  {needle
                    ? "Check the spelling, or clear the search to see every client."
                    : "No client is in this state right now. Clear the filter to see the rest."}
                </span>
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
          // the name link, whose name is just the client's. From `lg` a click
          // opens the quick look instead, and the name link keeps the full
          // open for Enter and a modifier click.
          <DataTable
            caption="Clients, with their Google health and open review work"
            rows={rows}
            rowId={(client) => client.id}
            onRowClick={(client) => {
              if (!quick.desk) {
                router.push(`/clients/${client.id}`)
                return
              }
              quick.show(
                client,
                document.querySelector<HTMLElement>(
                  `[data-quick-look-link="${CSS.escape(client.id)}"]`
                )
              )
            }}
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
                        // A full touch-height row on touch, as the bulk and
                        // client settings record cards do; a text link at the desk.
                        className="inline-flex min-h-(--np-touch) items-center rounded-(--np-radius-tag) text-body font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline desk:min-h-0"
                        data-quick-look-link={client.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          quick.intercept(event, client)
                        }}
                      >
                        {client.name}
                      </ShellLink>
                      {/* A card says this in its meta line. */}
                      <span className="text-caption text-ink-muted tabular-nums @max-3xl/table:hidden">
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
                // The cell is a whole phrase, so a card's meta line reads as
                // a sentence ("3 of 3 listings linked"), not a label and a
                // figure.
                label: "",
                cell: (client) => (
                  <span className="font-sans text-caption text-ink-muted tabular-nums">
                    {linkedSentence(client)}
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
                // "Synced 3 minutes ago" or "Not synced yet": a sentence on
                // a card, never a label joined to a bare value.
                label: "",
                cell: (client) => (
                  <span
                    className={cn(
                      "text-caption tabular-nums",
                      client.health === "disconnected"
                        ? "text-danger-ink"
                        : "text-ink-muted"
                    )}
                  >
                    {client.lastSyncAt ? (
                      <RelativeTime iso={client.lastSyncAt} prefix="Synced " />
                    ) : (
                      "Not synced yet"
                    )}
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
        {quick.item ? (
          <ClientQuickLook
            // The latest figures for the client, if it is still listed.
            client={
              all.find((client) => client.id === quick.item?.id) ?? quick.item
            }
            {...quick.panelProps}
          />
        ) : null}
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
      <div className="flex min-w-0 flex-col gap-0.5">
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
          className={SEARCH_PILL}
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
              <span className="text-caption">
                {needle
                  ? "Clear the search to see every archived client."
                  : "Clients you archive appear here, ready to restore."}
              </span>
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
                  <span className="text-body font-semibold break-words text-ink">
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
                <span className="text-caption text-ink-muted tabular-nums">
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
                  variant="ghost"
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

/**
 * The desk quick look for one client (DSK-23): its health, its open review
 * work and the Google login behind it, with "Open client" for the rest.
 * Each work figure links to the inbox filtered to this client, as the
 * client page's tiles do.
 */
function ClientQuickLook({
  client,
  ...panel
}: {
  client: ClientSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const note = clientHealthNote(client)
  const { needsReply, awaitingApproval, failed } = client.openWork
  const inbox = (queue: string) =>
    `/inbox?clientId=${encodeURIComponent(client.id)}&queue=${queue}`
  const work = [
    { label: "Needs reply", count: needsReply, queue: "needs_reply" },
    { label: "Awaiting approval", count: awaitingApproval, queue: "approval" },
    { label: "Replies that didn’t post", count: failed, queue: "failed" },
  ]
  return (
    <QuickLookPanel
      {...panel}
      title={client.name}
      description={linkedSentence(client)}
      status={
        <>
          <StatusPill
            tone={healthTone(client.health)}
            dashed={client.health === "not_connected"}
          >
            {healthLabel(client.health)}
          </StatusPill>
          {note ? (
            <span className="text-caption text-ink-muted">{note}</span>
          ) : null}
        </>
      }
      openHref={`/clients/${client.id}`}
      openLabel="Open client"
    >
      <QuickLookSection title="Open review work">
        <QuickLookFacts>
          {work.map((item) => (
            <QuickLookFact key={item.queue} label={item.label}>
              {item.count === 0 ? (
                <span className="text-ink-muted">None</span>
              ) : (
                <Link
                  href={inbox(item.queue)}
                  className={cn(
                    "rounded-(--np-radius-tag) font-medium tabular-nums underline-offset-4 focus-halo hover:underline",
                    item.queue === "failed" ? "text-danger-ink" : "text-ink"
                  )}
                >
                  {formatNumber(item.count)}
                  <span className="sr-only"> in the inbox</span>
                </Link>
              )}
            </QuickLookFact>
          ))}
        </QuickLookFacts>
      </QuickLookSection>
      <QuickLookSection title="Google">
        <QuickLookFacts>
          <QuickLookFact label="Login">
            <LoginCell client={client} />
          </QuickLookFact>
          <QuickLookFact label="Last sync">
            <span
              className={cn(
                "tabular-nums",
                client.health === "disconnected"
                  ? "text-danger-ink"
                  : "text-ink-muted"
              )}
            >
              {client.lastSyncAt ? (
                <RelativeTime iso={client.lastSyncAt} />
              ) : (
                "Not synced yet"
              )}
            </span>
          </QuickLookFact>
          <QuickLookFact label="Verified on Google">
            <span className="tabular-nums">
              {formatNumber(client.verifiedCount)} of{" "}
              {formatNumber(client.locationCount)}
            </span>
          </QuickLookFact>
        </QuickLookFacts>
      </QuickLookSection>
    </QuickLookPanel>
  )
}

/** "3 of 3 listings linked"; "No listings" when none are filed. */
function linkedSentence(client: ClientSummary) {
  if (client.locationCount === 0) return "No listings"
  return `${formatNumber(client.linkedCount)} of ${formatNumber(client.locationCount)} ${client.locationCount === 1 ? "listing" : "listings"} linked`
}

function OpenWork({ client }: { client: ClientSummary }) {
  const { needsReply, awaitingApproval, failed } = client.openWork
  if (needsReply + awaitingApproval + failed === 0) {
    // A state in words, drawn as a status (dot + word, no fill).
    return (
      // Sans, not the numeric column's mono; on a record card the short word
      // keeps the client name to one line (the full phrase stays for readers).
      <StatusPill
        tone="neutral"
        variant="inline"
        data-slot="open-work-none"
        className="font-sans"
      >
        <span className="@max-3xl/table:sr-only">Nothing to reply to</span>
        <span aria-hidden className="@3xl/table:hidden">
          Nothing due
        </span>
      </StatusPill>
    )
  }
  // Plain text, not a link: the whole card opens the client, so a second
  // target inside it would go somewhere else. The Inbox is one tap away on
  // the client's page. Sans, not the numeric column's mono.
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 font-sans tabular-nums">
      {needsReply > 0 ? (
        <span className="font-medium text-ink">
          {formatNumber(needsReply)} to reply
        </span>
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
      <div aria-hidden className="flex flex-col gap-2 md:gap-3">
        <Skeleton className="h-(--np-field-h) w-full rounded-(--np-radius-pill) max-md:h-(--np-touch) md:w-80" />
        <div className="flex min-w-0 gap-2 overflow-hidden">
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
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Skeleton aria-hidden className="h-6 w-28" />
          <p role="status" className="text-caption text-ink-muted">
            Loading clients…
          </p>
        </div>
        {/* A phone: flat rows, an avatar square and three bars (name,
            health word, meta line), on inset hairlines. */}
        <div aria-hidden className="md:hidden">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-start gap-3 py-3">
              <Skeleton className="size-8 shrink-0 rounded-(--np-radius-control)" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-b border-line-subtle pb-3">
                <Skeleton className="h-4.5 w-40 max-w-full" />
                <Skeleton className="h-4 w-20 rounded-(--np-radius-tag)" />
                <Skeleton className="h-3.5 w-48 max-w-full" />
              </div>
            </div>
          ))}
        </div>
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

/**
 * The client count beside the page title ("Clients 12"), in the title's
 * size at regular weight, once the list has loaded. Hidden from assistive
 * tech: the list's result line already announces the same number.
 */
function ClientsCount() {
  const clients = useClients()
  const count = clients.data?.items.length
  if (!clients.isSuccess || count === undefined) return null
  return (
    <span
      aria-hidden
      className="text-page-title font-normal text-ink-muted tabular-nums"
    >
      {formatNumber(count)}
    </span>
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

export { ClientsCount, ClientsIndex, ClientsSkeleton, NewClientButton }
