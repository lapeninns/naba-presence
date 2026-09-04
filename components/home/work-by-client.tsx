"use client"

import Link from "next/link"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { DataTable } from "@/components/ui/data-table"
import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { formatRelativeTime } from "@/lib/format/date"

const HEADING_ID = "work-by-client-heading"

/**
 * Who needs you today, by client.
 *
 * Home used to answer "how many replies are waiting" across the whole
 * organisation, which is the right question for one venue and useless for an
 * agency: twenty waiting replies tell you nothing about which of your fifteen
 * clients is being ignored. The same numbers, split by client, are a to-do
 * list.
 */
function WorkByClient({
  clients,
  isPending,
}: {
  clients: ClientSummary[] | undefined
  isPending?: boolean
}) {
  if (isPending) {
    return (
      <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
        <h2 id={HEADING_ID} className="text-section font-medium tracking-tight">
          Work by client
        </h2>
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 rounded-(--np-radius-card)" />
          ))}
        </div>
      </section>
    )
  }

  const rows = (clients ?? [])
    .map((client) => ({
      ...client,
      open:
        client.openWork.needsReply +
        client.openWork.awaitingApproval +
        client.openWork.failed,
    }))
    // Busiest first: the point of the list is what to do next.
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-section font-medium tracking-tight">
        Work by client
      </h2>
      <DataTable
        caption="Open work for each client"
        rows={rows}
        rowId={(row) => row.id}
        density="compact"
        empty={
          <p className="text-ui text-ink-muted">
            No clients yet.{" "}
            <Link href="/clients/new" className="underline">
              Add your first one
            </Link>
            .
          </p>
        }
        columns={[
          {
            id: "client",
            header: "Client",
            cell: (row) => (
              <Link
                href={`/clients/${row.id}`}
                className="flex items-center gap-2 font-medium hover:underline"
              >
                <ClientAvatar name={row.name} colour={row.colour} size="sm" />
                {row.name}
              </Link>
            ),
          },
          {
            id: "health",
            header: "Health",
            cell: (row) => (
              <StatusPill tone={healthTone(row.health)}>
                {healthLabel(row.health)}
              </StatusPill>
            ),
          },
          {
            id: "needs_reply",
            header: "Needs reply",
            className: "text-right tabular-nums",
            cell: (row) =>
              row.openWork.needsReply > 0 ? (
                <Link
                  href={`/inbox?queue=needs_reply&clientId=${row.id}`}
                  className="underline"
                >
                  {formatNumber(row.openWork.needsReply)}
                </Link>
              ) : (
                <span className="text-ink-faint">0</span>
              ),
          },
          {
            id: "awaiting",
            header: "Awaiting approval",
            className: "text-right tabular-nums",
            cell: (row) =>
              row.openWork.awaitingApproval > 0 ? (
                <Link
                  href={`/inbox?queue=awaiting_my_approval&clientId=${row.id}`}
                  className="underline"
                >
                  {formatNumber(row.openWork.awaitingApproval)}
                </Link>
              ) : (
                <span className="text-ink-faint">0</span>
              ),
          },
          {
            id: "failed",
            header: "Failed",
            className: "text-right tabular-nums",
            cell: (row) =>
              row.openWork.failed > 0 ? (
                <Link
                  href={`/inbox?queue=failed&clientId=${row.id}`}
                  className="text-danger-ink underline"
                >
                  {formatNumber(row.openWork.failed)}
                </Link>
              ) : (
                <span className="text-ink-faint">0</span>
              ),
          },
          {
            id: "synced",
            header: "Last sync",
            cell: (row) => (
              <span className="text-ink-muted">
                {row.lastSyncAt ? formatRelativeTime(row.lastSyncAt) : "Never"}
              </span>
            ),
          },
        ]}
      />
    </section>
  )
}

export { WorkByClient }
