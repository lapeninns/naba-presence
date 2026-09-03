"use client"

import { Plus, RefreshCw } from "lucide-react"
import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { KpiTile } from "@/components/ui/kpi-tile"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import {
  healthDescription,
  healthLabel,
  healthTone,
} from "@/lib/clients/health"
import type { ClientResponse } from "@/lib/contracts/clients"
import { formatRelativeTime } from "@/lib/format"
import { useClient } from "@/lib/queries/use-clients"

const SECTIONS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "performance", label: "Performance" },
]

/**
 * One client's home: how it is doing, what needs doing, and its locations.
 *
 * This is the level an agency actually works at. Everything below — a
 * location's profile, its hours, its photos — is reached from here, which is
 * why each location row carries its own section links rather than making the
 * operator open the location first and then find the tab.
 */
function ClientHub({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const query = useClient(clientId)

  return (
    <QueryStates
      status={
        query.isPending ? "pending" : query.isError ? "error" : "ready"
      }
      error="We couldn't load this client"
      onRetry={() => void query.refetch()}
    >
      {() => {
        const data = query.data as ClientResponse
        const { client, locations } = data
        const linked = locations.filter((location) => location.linkId)
        return (
          <>
            <PageHeader
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
                canManage ? (
                  <>
                    <Link
                      href={`/clients/${client.id}/settings`}
                      className={buttonVariants({ variant: "outline" })}
                    >
                      Client settings
                    </Link>
                    <Link
                      href={`/setup?client=${client.id}&step=locations`}
                      className={buttonVariants({ variant: "outline" })}
                    >
                      <Plus className="size-4" aria-hidden />
                      Add locations
                    </Link>
                    <Link
                      href={`/inbox?clientId=${client.id}`}
                      className={buttonVariants()}
                    >
                      Open inbox
                    </Link>
                  </>
                ) : (
                  <Link href={`/inbox?clientId=${client.id}`} className={buttonVariants()}>
                    Open inbox
                  </Link>
                )
              }
            />

            {client.health === "disconnected" && canManage ? (
              <ReconnectPrompt client={client} />
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Needs reply"
                value={client.openWork.needsReply}
                hint={
                  client.openWork.needsReply === 0
                    ? "Nothing waiting"
                    : "Across this client's locations"
                }
              />
              <KpiTile
                label="Awaiting approval"
                value={client.openWork.awaitingApproval}
                hint={
                  client.openWork.awaitingApproval === 0
                    ? "Nothing waiting"
                    : "Drafted, not yet published"
                }
              />
              <KpiTile
                label="Locations linked"
                value={`${client.linkedCount} / ${client.locationCount}`}
                hint={`${client.verifiedCount} verified on Google`}
              />
              <KpiTile
                label="Failed publishes"
                value={client.openWork.failed}
                hint={client.openWork.failed === 0 ? "None" : "Need a retry"}
              />
            </div>

            <section
              aria-labelledby="client-locations"
              className="overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
            >
              <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
                <h2 id="client-locations" className="text-title">
                  Locations
                </h2>
                <p className="text-caption text-ink-muted">
                  {linked.length} linked · {client.verifiedCount} verified
                </p>
              </div>

              {locations.length === 0 ? (
                <Empty
                  title="No locations yet"
                  description="Link this client's Google locations so their reviews start flowing in."
                  action={
                    canManage ? (
                      <Link
                        href={`/setup?client=${client.id}&step=locations`}
                        className={buttonVariants()}
                      >
                        Add locations from Google
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                <ul>
                  {locations.map((location) => (
                    <li
                      key={location.locationId}
                      className="flex flex-col gap-2 border-b border-line-subtle px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/locations/${location.locationId}`}
                          className="font-medium text-ink underline-offset-4 hover:underline"
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
                      <nav
                        aria-label={`${location.name} sections`}
                        className="flex flex-wrap gap-1"
                      >
                        {SECTIONS.map((section) => (
                          <Link
                            key={section.label}
                            href={`/locations/${location.locationId}${section.segment ? `/${section.segment}` : ""}`}
                            className="rounded-(--np-radius-control) bg-surface-sunken px-2 py-1 text-caption text-ink-muted transition-colors duration-(--np-duration-fast) hover:text-ink"
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
          </>
        )
      }}
    </QueryStates>
  )
}

function ReconnectPrompt({
  client,
}: {
  client: ClientResponse["client"]
}) {
  const broken =
    client.connections.find((connection) => connection.reconnectRequired) ??
    client.connections.find((connection) => connection.status !== "active")
  return (
    <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-[var(--np-danger-line)] bg-danger-tint px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="text-ui font-medium text-danger-ink">
          Google needs reconnecting
        </p>
        <p className="text-caption text-danger-ink/90">
          {broken?.googleEmail
            ? `${broken.googleEmail} can no longer reach ${client.name}'s Business Profile. Reviews and profile changes have stopped syncing.`
            : `Reviews and profile changes for ${client.name} have stopped syncing.`}
        </p>
      </div>
      <Link
        href={`/setup?client=${client.id}&step=connect`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Reconnect
      </Link>
    </div>
  )
}

export { ClientHub }
