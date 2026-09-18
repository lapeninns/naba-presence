"use client"

import {
  BarChart3Icon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react"
import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { KpiTile } from "@/components/ui/kpi-tile"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import {
  healthDescription,
  healthLabel,
  healthTone,
} from "@/lib/clients/health"
import type { ClientResponse } from "@/lib/contracts/clients"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { useClient } from "@/lib/queries/use-clients"

// The three jobs of the workspace, with Content opening on photos, plus the
// location's report, which lives on Reports rather than in the workspace.
const SECTIONS = [
  { href: (id: string) => `/locations/${id}`, label: "Listing" },
  { href: (id: string) => `/locations/${id}/photos`, label: "Photos" },
  { href: (id: string) => `/locations/${id}/posts`, label: "Posts" },
  { href: (id: string) => `/reports?locationId=${id}`, label: "Reports" },
]

/**
 * One client's home: how it is doing, what needs doing, and its locations.
 *
 * This is the level an agency actually works at. Everything below — a
 * location's profile, its hours, its photos — is reached from here, which is
 * why each location row carries its own section links rather than making the
 * operator open the location first and then find the tab.
 */
function ClientHub({
  clientId,
  canManage,
}: {
  clientId: string
  canManage: boolean
}) {
  const query = useClient(clientId)

  return (
    <QueryStates
      status={query.isPending ? "pending" : query.isError ? "error" : "ready"}
      error="We couldn't load this client"
      onRetry={() => void query.refetch()}
    >
      {() => {
        const data = query.data as ClientResponse
        const { client, locations } = data
        const linked = locations.filter((location) => location.linkId)
        return (
          <>
            <div className="flex items-start gap-4">
              <ClientAvatar
                name={client.name}
                colour={client.colour}
                size="xl"
                className="mt-1"
              />
              <PageHeader
                className="min-w-0 flex-1"
                title={client.name}
                eyebrow="Client"
                meta={
                  <StatusPill tone={healthTone(client.health)}>
                    {healthLabel(client.health)}
                  </StatusPill>
                }
                description={
                  <>
                    {healthDescription(client.health)}
                    {client.lastSyncAt
                      ? ` Last synced ${formatRelativeTime(client.lastSyncAt)}.`
                      : ""}
                  </>
                }
                actions={
                  <>
                    {canManage ? (
                      <Link
                        href={`/setup?client=${client.id}&step=locations`}
                        className={buttonVariants({ variant: "secondary" })}
                      >
                        <PlusIcon aria-hidden strokeWidth={1.75} />
                        Add locations
                      </Link>
                    ) : null}
                    <Link
                      href={`/inbox?clientId=${client.id}`}
                      className={buttonVariants()}
                    >
                      Open inbox
                    </Link>
                  </>
                }
              />
            </div>

            {client.health === "disconnected" && canManage ? (
              <ReconnectPrompt client={client} />
            ) : null}

            <div className="grid gap-(--np-gap-card) sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Needs reply"
                value={formatNumber(client.openWork.needsReply)}
                hint={
                  client.openWork.needsReply === 0
                    ? "Nothing waiting"
                    : "Across this client's locations"
                }
              />
              <KpiTile
                label="Awaiting approval"
                value={formatNumber(client.openWork.awaitingApproval)}
                hint={
                  client.openWork.awaitingApproval === 0
                    ? "Nothing waiting"
                    : "Drafted, not yet published"
                }
              />
              <KpiTile
                label="Locations linked"
                value={`${formatNumber(client.linkedCount)} / ${formatNumber(client.locationCount)}`}
                hint={`${formatNumber(client.verifiedCount)} verified on Google`}
              />
              <KpiTile
                label="Failed publishes"
                value={formatNumber(client.openWork.failed)}
                hint={client.openWork.failed === 0 ? "None" : "Need a retry"}
              />
            </div>

            <section
              aria-labelledby="client-locations"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <h2
                  id="client-locations"
                  className="text-title font-semibold text-ink"
                >
                  Locations
                </h2>
                <p className="text-caption text-ink-muted tabular-nums">
                  {formatNumber(linked.length)} linked ·{" "}
                  {formatNumber(client.verifiedCount)} verified
                </p>
              </div>

              {locations.length === 0 ? (
                <div className="rounded-(--np-radius-card) bg-surface">
                  <Empty
                    icon={<MapPinIcon />}
                    title="No locations yet"
                    description="Link this client's Google locations so their reviews start flowing in."
                    action={
                      canManage ? (
                        <Link
                          href={`/setup?client=${client.id}&step=locations`}
                          className={buttonVariants({ pill: true })}
                        >
                          Add locations from Google
                        </Link>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface">
                  {locations.map((location) => (
                    <li
                      key={location.locationId}
                      className="flex flex-col gap-2 px-(--np-card-pad) py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <StatusPill
                          variant="dot"
                          tone={
                            location.linkId
                              ? location.verified
                                ? "healthy"
                                : "pending"
                              : "neutral"
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/locations/${location.locationId}`}
                            className="rounded-(--np-radius-tag) text-body font-medium text-ink underline-offset-4 focus-halo hover:underline"
                          >
                            {location.name}
                          </Link>
                          <p className="truncate text-caption text-ink-muted">
                            {location.linkId
                              ? location.verified
                                ? "Linked to Google · Verified"
                                : "Linked to Google · Pending verification"
                              : "Not linked to Google"}
                          </p>
                        </div>
                      </div>
                      <nav
                        aria-label={`${location.name} sections`}
                        className="flex flex-wrap gap-1 sm:justify-end"
                      >
                        {SECTIONS.map((section) => (
                          <Link
                            key={section.label}
                            href={section.href(location.locationId)}
                            className={buttonVariants({
                              variant: "secondary",
                              size: "xs",
                              pill: true,
                            })}
                          >
                            {section.label}
                          </Link>
                        ))}
                      </nav>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <GroupedList header="Manage">
              <GroupedListItem
                icon={<BarChart3Icon />}
                label="Reports"
                description="Replies, visibility and search keywords for this client"
                href={`/reports?clientId=${client.id}`}
              />
              {canManage ? (
                <GroupedListItem
                  icon={<Settings2Icon />}
                  label="Client settings"
                  description="Name, notes, filed locations and archiving"
                  href={`/clients/${client.id}/settings`}
                />
              ) : null}
            </GroupedList>
          </>
        )
      }}
    </QueryStates>
  )
}

function ReconnectPrompt({ client }: { client: ClientResponse["client"] }) {
  const broken =
    client.connections.find((connection) => connection.reconnectRequired) ??
    client.connections.find((connection) => connection.status !== "active")
  return (
    <Alert variant="destructive">
      <AlertTitle>Google needs reconnecting</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          {broken?.googleEmail
            ? `${broken.googleEmail} can no longer reach ${client.name}'s Business Profile. Reviews and profile changes have stopped syncing.`
            : `Reviews and profile changes for ${client.name} have stopped syncing.`}
        </span>
        <Link
          href={`/setup?client=${client.id}&step=connect`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <RefreshCwIcon aria-hidden strokeWidth={1.75} />
          Reconnect
        </Link>
      </AlertDescription>
    </Alert>
  )
}

export { ClientHub }
