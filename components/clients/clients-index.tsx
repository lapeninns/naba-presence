"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useClients } from "@/lib/queries/use-clients"
import { formatRelativeTime } from "@/lib/format"

/**
 * Every client, ordered so the ones needing work come first.
 *
 * An agency opens this to answer "where do I go now", so the default order is
 * by open work rather than alphabetically: a name-sorted list makes the
 * operator read all forty rows to find the two that matter.
 */
function ClientsIndex({ role }: { role: string | null }) {
  const clients = useClients()
  const router = useRouter()
  const canCreate = role === "owner" || role === "admin"

  if (clients.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }

  if (clients.isError) {
    return (
      <Empty
        title="We couldn't load your clients"
        description="Something went wrong reaching the server."
        action={
          <Button variant="outline" onClick={() => clients.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const items = [...(clients.data?.items ?? [])].sort((a, b) => {
    const workA = a.openWork.needsReply + a.openWork.awaitingApproval
    const workB = b.openWork.needsReply + b.openWork.awaitingApproval
    if (workA !== workB) return workB - workA
    return a.name.localeCompare(b.name)
  })
  const unassigned = clients.data?.unassignedLocationCount ?? 0

  if (items.length === 0) {
    return (
      <Empty
        title={canCreate ? "Set up your first client" : "No clients yet"}
        description={
          canCreate
            ? "A client is a business you look after. Add one, then connect the Google account that manages its Business Profile."
            : "Your agency hasn't set up any clients yet. An owner or admin can add the first one."
        }
        action={
          canCreate ? (
            <Link href="/clients/new" className={buttonVariants()}>
              New client
            </Link>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Clients, with their Google health and open review work"
        rows={items}
        rowId={(client) => client.id}
        onRowClick={(client) => router.push(`/clients/${client.id}`)}
        density="compact"
        columns={[
          {
            id: "name",
            header: "Client",
            cell: (client) => (
              <span className="flex items-center gap-2.5">
                <ClientAvatar name={client.name} colour={client.colour} />
                <Link
                  href={`/clients/${client.id}`}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {client.name}
                </Link>
              </span>
            ),
          },
          {
            id: "health",
            header: "Health",
            cell: (client) => (
              <StatusPill tone={healthTone(client.health)}>
                {healthLabel(client.health)}
              </StatusPill>
            ),
          },
          {
            id: "locations",
            header: "Locations",
            cell: (client) => (
              <span className="tabular-nums">
                {client.linkedCount} / {client.locationCount}
              </span>
            ),
          },
          {
            id: "work",
            header: "Needs reply · approval",
            cell: (client) => <OpenWork client={client} />,
          },
          {
            id: "sync",
            header: "Last sync",
            cell: (client) => (
              <span className="text-ink-muted">
                {client.lastSyncAt ? formatRelativeTime(client.lastSyncAt) : "Not yet"}
              </span>
            ),
          },
        ]}
      />

      {unassigned > 0 ? (
        <div className="flex items-center gap-3 rounded-(--np-radius-card) border border-line bg-surface-sunken px-4 py-3">
          <div className="flex-1">
            <p className="text-ui font-medium">
              {unassigned === 1
                ? "1 location has no client"
                : `${unassigned} locations have no client`}
            </p>
            <p className="text-caption text-ink-muted">
              Imported from Google but not yet filed under a client. They stay
              out of client filters and reports until you assign them.
            </p>
          </div>
          <Link
            href="/locations"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Review locations
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function OpenWork({ client }: { client: ClientSummary }) {
  const { needsReply, awaitingApproval, failed } = client.openWork
  if (needsReply + awaitingApproval + failed === 0) {
    return <span className="text-ink-muted">Clear</span>
  }
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className="font-medium">{needsReply}</span>
      <span className="text-ink-muted">·</span>
      <span className="text-ink-muted">{awaitingApproval}</span>
      {failed > 0 ? (
        <StatusPill tone="at-risk" variant="inline">
          {failed} failed
        </StatusPill>
      ) : null}
    </span>
  )
}

export { ClientsIndex, NewClientButton }

function NewClientButton() {
  return (
    <Link href="/clients/new" className={buttonVariants()}>
      <Plus className="size-4" aria-hidden />
      New client
    </Link>
  )
}
