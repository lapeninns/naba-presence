"use client"

import {
  BarChart3Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  InboxIcon,
  KeyRoundIcon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react"
import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  healthDescription,
  healthLabel,
  healthTone,
} from "@/lib/clients/health"
import type { ClientResponse } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { formatAddressLine } from "@/lib/locations/address"
import { useClient } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

type Client = ClientResponse["client"]
type Listing = ClientResponse["locations"][number]

// The listing's overview and its busiest areas, plus its report on Reports.
const SECTIONS = [
  { href: (id: string) => `/listings/${id}`, label: "Listing" },
  { href: (id: string) => `/listings/${id}/profile`, label: "Profile" },
  { href: (id: string) => `/listings/${id}/photos`, label: "Photos" },
  { href: (id: string) => `/listings/${id}/posts`, label: "Posts" },
  { href: (id: string) => `/reports?locationId=${id}`, label: "Reports" },
]

/**
 * One client's home: how it is doing, what needs doing, and its listings.
 *
 * This is the level an agency actually works at. Everything below — a
 * listing's profile, its hours, its photos — is reached from here, which is
 * why each listing row carries its own section links rather than making the
 * operator open the listing first and then find the tab.
 *
 * Reference `client.hub`: header with the Google login behind the client and
 * the one primary action that matters now (Reconnect, Finish setup, or Open
 * inbox), four work tiles that each open the filtered inbox, the listings
 * table, and a side column. Everything shown comes from the client summary;
 * the reference's activity feed has no data source here and is left out.
 */
function ClientHub({
  clientId,
  canManage,
}: {
  clientId: string
  canManage: boolean
}) {
  const query = useClient(clientId)

  if (query.isPending) return <HubSkeleton />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Client" eyebrow="Client" />
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          <Empty
            tone="bad"
            titleAs="h2"
            icon={<CircleAlertIcon />}
            title="We couldn't load this client"
            description={`${describeActionError(query.error)} Health, work and listings aren’t shown until it loads. Nothing was changed.`}
            action={
              <>
                <Button
                  variant="secondary"
                  pending={query.isFetching}
                  pendingLabel="Trying again…"
                  onClick={() => void query.refetch()}
                >
                  <RefreshCwIcon aria-hidden />
                  Try again
                </Button>
                <Link
                  href="/clients"
                  className={cn(buttonVariants({ variant: "ghost" }))}
                >
                  All clients
                </Link>
              </>
            }
          />
        </div>
      </>
    )
  }

  const { client, locations } = query.data
  const broken = client.connections.filter(
    (connection) =>
      connection.reconnectRequired || connection.status !== "active"
  )
  const needsReconnect = broken.length > 0
  const notSetUp = client.health === "not_connected"

  const actions: React.ReactNode[] = []
  if (canManage && needsReconnect) {
    actions.push(
      <Link
        key="reconnect"
        href={`/setup?client=${client.id}&step=connect`}
        className={cn(buttonVariants())}
      >
        <RefreshCwIcon aria-hidden strokeWidth={1.75} />
        Reconnect Google
      </Link>
    )
  }
  if (canManage && notSetUp && !needsReconnect) {
    actions.push(
      <Link
        key="finish"
        href={`/setup?client=${client.id}`}
        className={cn(buttonVariants())}
      >
        Finish setup
      </Link>
    )
  }
  const inboxIsPrimary = actions.length === 0
  if (inboxIsPrimary || !notSetUp) {
    actions.push(
      <Link
        key="inbox"
        href={`/inbox?clientId=${client.id}`}
        className={cn(
          buttonVariants({
            variant: inboxIsPrimary ? "default" : "secondary",
          })
        )}
      >
        {inboxIsPrimary ? <InboxIcon aria-hidden strokeWidth={1.75} /> : null}
        Open inbox
      </Link>
    )
  }
  if (canManage) {
    actions.push(
      <Link
        key="settings"
        href={`/clients/${client.id}/settings`}
        className={cn(buttonVariants({ variant: "secondary" }))}
      >
        <Settings2Icon aria-hidden strokeWidth={1.75} />
        Settings
      </Link>
    )
  }
  actions.push(
    <Link
      key="report"
      href={`/reports?clientId=${client.id}`}
      className={cn(buttonVariants({ variant: "ghost" }))}
    >
      <BarChart3Icon aria-hidden strokeWidth={1.75} />
      Report
    </Link>
  )
  // The primary goes last so it sits at the trailing edge.
  const primaryFirst = actions.shift()
  const ordered = [...actions.reverse(), primaryFirst]

  return (
    <>
      <div className="flex min-w-0 items-start gap-4">
        <ClientAvatar
          name={client.name}
          colour={client.colour}
          size="lg"
          className="mt-1 hidden @min-[480px]:flex"
        />
        <PageHeader
          className="min-w-0 flex-1"
          title={client.name}
          eyebrow="Client"
          meta={
            <StatusPill tone={healthTone(client.health)} dashed={notSetUp}>
              {healthLabel(client.health)}
            </StatusPill>
          }
          description={
            <span className="flex flex-col gap-1.5">
              <span>
                {healthDescription(client.health)}
                {client.lastSyncAt
                  ? ` Last synced ${formatRelativeTime(client.lastSyncAt)}.`
                  : ""}
              </span>
              <LoginLine client={client} />
            </span>
          }
          actions={<>{ordered}</>}
        />
      </div>

      {client.health === "disconnected" && canManage ? (
        <ReconnectPrompt client={client} />
      ) : null}

      <section aria-labelledby="client-work" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="client-work" className="text-title font-semibold text-ink">
            Work for this client
          </h2>
          <p className="text-caption text-ink-muted">
            Each opens the inbox or listings filtered to {client.name}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 @min-[820px]:grid-cols-4">
          <WorkTile
            label="Needs reply"
            value={formatNumber(client.openWork.needsReply)}
            hint={
              client.openWork.needsReply === 0
                ? "Nothing waiting"
                : "Across this client's listings"
            }
            href={`/inbox?clientId=${client.id}&queue=needs_reply`}
          />
          <WorkTile
            label="Awaiting approval"
            value={formatNumber(client.openWork.awaitingApproval)}
            hint={
              client.openWork.awaitingApproval === 0
                ? "Nothing waiting"
                : "Drafted, not yet published"
            }
            href={`/inbox?clientId=${client.id}&queue=approval`}
          />
          <WorkTile
            label="Failed publishes"
            value={formatNumber(client.openWork.failed)}
            hint={client.openWork.failed === 0 ? "None" : "Need a retry"}
            tone={client.openWork.failed > 0 ? "bad" : undefined}
            href={`/inbox?clientId=${client.id}&queue=failed`}
          />
          <WorkTile
            label="Listings linked"
            value={`${formatNumber(client.linkedCount)} / ${formatNumber(client.locationCount)}`}
            hint={`${formatNumber(client.verifiedCount)} verified on Google`}
            href={`/listings?clientId=${client.id}`}
          />
        </div>
      </section>

      <div className="grid items-start gap-6 @min-[980px]:grid-cols-[minmax(0,1fr)_minmax(16rem,21rem)]">
        <ListingsSection
          client={client}
          listings={locations}
          canManage={canManage}
        />
        <aside
          aria-label={`${client.name} details`}
          className="flex flex-col gap-4"
        >
          <ImportCard client={client} canManage={canManage} />
          <section
            aria-labelledby="client-notes"
            className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-4"
          >
            <h2 id="client-notes" className="text-body font-semibold text-ink">
              Notes for the team
            </h2>
            <p
              className={cn(
                "text-ui break-words whitespace-pre-line",
                client.notes ? "text-ink" : "text-ink-muted"
              )}
            >
              {client.notes || "No notes yet."}
            </p>
            {canManage ? (
              <Link
                href={`/clients/${client.id}/settings#details`}
                className="self-start rounded-(--np-radius-tag) text-ui font-medium text-accent-ink underline underline-offset-3 focus-halo pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"
              >
                Edit notes
              </Link>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  )
}

/** "Behind it: <login>" with its state, from the client's real connections. */
function LoginLine({ client }: { client: Client }) {
  const [first, ...rest] = client.connections
  if (!first) {
    return (
      <span className="flex items-center gap-2 text-ui text-ink-muted">
        <KeyRoundIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
        No Google login connected yet.
      </span>
    )
  }
  const firstBroken = first.reconnectRequired || first.status !== "active"
  return (
    <span className="flex flex-wrap items-center gap-2 text-ui text-ink-secondary">
      <KeyRoundIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Behind it:{" "}
        <strong className="font-semibold text-ink">
          {first.googleEmail ?? "Google account"}
        </strong>
        {rest.length > 0 ? ` and ${formatNumber(rest.length)} more` : ""}
      </span>
      {firstBroken ? (
        <StatusPill tone="bad">
          Needs reconnecting
          {first.lastRefreshAt
            ? ` · last refresh ${formatRelativeTime(first.lastRefreshAt)}`
            : ""}
        </StatusPill>
      ) : (
        <StatusPill tone="ok">
          Connected
          {first.lastRefreshAt
            ? ` · refreshed ${formatRelativeTime(first.lastRefreshAt)}`
            : ""}
        </StatusPill>
      )}
    </span>
  )
}

function WorkTile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string
  value: string
  hint: string
  href: string
  tone?: "bad"
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface p-4 text-ink no-underline focus-halo transition-[border-color,box-shadow] duration-(--np-duration-fast) hover:border-line-strong hover:shadow-np-raised"
    >
      <span className="flex items-center justify-between gap-2 text-ui font-medium text-ink-muted">
        {label}
        <ChevronRightIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 transition-transform duration-(--np-duration-fast) group-hover:translate-x-0.5"
        />
      </span>
      <span
        className={cn(
          "font-mono text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums",
          tone === "bad" ? "text-danger-ink" : "text-ink"
        )}
      >
        {value}
      </span>
      <span className="text-caption text-ink-muted">{hint}</span>
    </Link>
  )
}

function ListingsSection({
  client,
  listings,
  canManage,
}: {
  client: Client
  listings: Listing[]
  canManage: boolean
}) {
  const linked = listings.filter((listing) => listing.linkId)
  const verified = listings.filter((listing) => listing.verified).length
  const add = canManage ? (
    <Link
      href={`/setup?client=${client.id}&step=locations`}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
    >
      <PlusIcon aria-hidden strokeWidth={1.75} />
      Add listings from Google
    </Link>
  ) : null

  return (
    <section
      aria-labelledby="client-listings"
      className="flex min-w-0 flex-col gap-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="client-listings" className="text-title font-semibold text-ink">
          Listings
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-caption text-ink-muted tabular-nums">
            {formatNumber(linked.length)} linked · {formatNumber(verified)}{" "}
            verified
          </span>
          {listings.length > 0 ? add : null}
        </div>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          <Empty
            titleAs="h3"
            icon={<MapPinIcon />}
            title="No listings yet"
            description={`Connect the Google account that manages ${client.name}'s Business Profile, then pick its locations. Reviews start arriving once a listing is linked.`}
            action={
              canManage ? (
                <Link
                  href={`/setup?client=${client.id}&step=locations`}
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Add listings from Google
                </Link>
              ) : (
                <span className="text-caption text-ink-muted">
                  An owner or admin can add listings.
                </span>
              )
            }
          />
        </div>
      ) : (
        <DataTable
          caption={`${client.name}'s listings with their Google link and verification`}
          rows={listings}
          rowId={(listing) => listing.locationId}
          surface
          responsive
          columns={[
            {
              id: "listing",
              header: "Listing",
              span: true,
              label: "",
              cell: (listing) => (
                <span className="flex min-w-0 flex-col">
                  <Link
                    href={`/listings/${listing.locationId}`}
                    className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
                  >
                    {listing.name}
                  </Link>
                  {formatAddressLine(listing.address) ? (
                    <span className="text-caption break-words text-ink-muted">
                      {formatAddressLine(listing.address)}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              id: "google",
              header: "Google",
              cell: (listing) =>
                listing.linkId ? (
                  client.health === "disconnected" ? (
                    <StatusPill tone="bad">Linked · paused</StatusPill>
                  ) : (
                    <StatusPill tone="ok">Linked</StatusPill>
                  )
                ) : (
                  <StatusPill tone="neutral" dashed>
                    Not linked
                  </StatusPill>
                ),
            },
            {
              id: "verified",
              header: "Verified",
              cell: (listing) =>
                !listing.linkId ? (
                  <span className="text-ui text-ink-muted">—</span>
                ) : listing.verified ? (
                  <StatusPill tone="ok">Verified</StatusPill>
                ) : (
                  <StatusPill tone="warn">Not verified</StatusPill>
                ),
            },
            {
              id: "sections",
              header: <span className="sr-only">Sections</span>,
              label: "",
              span: true,
              className: "text-right",
              cell: (listing) => (
                <nav
                  aria-label={`${listing.name} sections`}
                  className="flex flex-wrap gap-1 @max-[720px]/table:justify-start @min-[720px]/table:justify-end"
                >
                  {SECTIONS.map((section) => (
                    <Link
                      key={section.label}
                      href={section.href(listing.locationId)}
                      className={cn(
                        buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })
                      )}
                    >
                      {section.label}
                    </Link>
                  ))}
                </nav>
              ),
            },
          ]}
        />
      )}
    </section>
  )
}

/** Review import across the client's listings, from the summary's counts. */
function ImportCard({
  client,
  canManage,
}: {
  client: Client
  canManage: boolean
}) {
  const { running, failed, succeeded, notStarted } = client.backfill
  const total = running + failed + succeeded + notStarted
  return (
    <section
      aria-labelledby="client-import"
      className="flex flex-col gap-2.5 rounded-(--np-radius-card) border border-line bg-surface p-4"
    >
      <h2 id="client-import" className="text-body font-semibold text-ink">
        Review import
      </h2>
      {total === 0 ? (
        <p className="text-ui text-ink-muted">
          Nothing to import until a listing is linked.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-ui">
          {running > 0 ? (
            <ImportRow tone="info" label="Importing" count={running} />
          ) : null}
          {failed > 0 ? (
            <ImportRow tone="bad" label="Stopped" count={failed} />
          ) : null}
          {succeeded > 0 ? (
            <ImportRow tone="ok" label="Complete" count={succeeded} />
          ) : null}
          {notStarted > 0 ? (
            <ImportRow tone="neutral" label="Not started" count={notStarted} />
          ) : null}
        </ul>
      )}
      {canManage && (failed > 0 || notStarted > 0) ? (
        <Link
          href={`/setup?client=${client.id}&step=backfill`}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "self-start"
          )}
        >
          {failed > 0 ? "Retry the import" : "Start the import"}
        </Link>
      ) : null}
    </section>
  )
}

function ImportRow({
  tone,
  label,
  count,
}: {
  tone: "info" | "bad" | "ok" | "neutral"
  label: string
  count: number
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <StatusPill tone={tone} dashed={tone === "neutral"}>
        {label}
      </StatusPill>
      <span className="font-mono text-caption text-ink-muted tabular-nums">
        {formatNumber(count)} {count === 1 ? "listing" : "listings"}
      </span>
    </li>
  )
}

function ReconnectPrompt({ client }: { client: Client }) {
  const broken =
    client.connections.find((connection) => connection.reconnectRequired) ??
    client.connections.find((connection) => connection.status !== "active")
  return (
    <Alert variant="destructive">
      <AlertTitle>Google needs reconnecting</AlertTitle>
      <AlertDescription>
        {broken?.googleEmail
          ? `${broken.googleEmail} can no longer reach ${client.name}'s Business Profile. Reviews and profile changes have stopped syncing.`
          : `Reviews and profile changes for ${client.name} have stopped syncing.`}
      </AlertDescription>
    </Alert>
  )
}

function HubSkeleton() {
  return (
    <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
      <div className="flex items-start gap-4">
        <Skeleton className="size-12 rounded-(--np-radius-card)" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <p role="status" className="text-ui text-ink-muted">
        Loading this client…
      </p>
      <div className="grid grid-cols-2 gap-3 @min-[820px]:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-(--np-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-(--np-radius-card)" />
    </div>
  )
}

export { ClientHub }
