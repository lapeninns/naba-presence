"use client"

import { Building2Icon } from "lucide-react"
import Link from "next/link"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { HomeSection, ListRowsSkeleton } from "@/components/home/home-section"
import { buttonVariants } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { StatusPill } from "@/components/ui/status-pill"
import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { formatRelativeTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"

const HEADING_ID = "work-by-client-heading"

const countLinkClassName =
  "rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-4 tabular-nums focus-halo hover:underline"

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
      <HomeSection id={HEADING_ID} title="Work by client">
        <ListRowsSkeleton rows={3} />
      </HomeSection>
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
    <HomeSection
      id={HEADING_ID}
      title="Work by client"
      description="Open work for each client, busiest first."
    >
      <DataTable
        caption="Open work for each client"
        rows={rows}
        rowId={(row) => row.id}
        density="compact"
        surface
        empty={
          <div className="rounded-(--np-radius-card) bg-surface">
            <Empty
              icon={<Building2Icon />}
              title="No clients yet"
              description="Add the first business you look after and its open work appears here."
              action={
                <Link
                  href="/clients/new"
                  className={buttonVariants({
                    variant: "secondary",
                    pill: true,
                  })}
                >
                  New client
                </Link>
              }
              className="py-8"
            />
          </div>
        }
        columns={[
          {
            id: "client",
            header: "Client",
            cell: (row) => (
              <Link
                href={`/clients/${row.id}`}
                className="inline-flex items-center gap-2.5 rounded-(--np-radius-tag) font-medium text-ink underline-offset-4 focus-halo hover:underline"
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
              <StatusPill variant="inline" tone={healthTone(row.health)}>
                {healthLabel(row.health)}
              </StatusPill>
            ),
          },
          {
            id: "needs_reply",
            header: "Needs reply",
            numeric: true,
            cell: (row) =>
              row.openWork.needsReply > 0 ? (
                <Link
                  href={`/inbox?queue=needs_reply&clientId=${row.id}`}
                  className={countLinkClassName}
                >
                  {formatNumber(row.openWork.needsReply)}
                </Link>
              ) : (
                <span className="text-ink-muted">0</span>
              ),
          },
          {
            id: "awaiting",
            header: "Awaiting approval",
            numeric: true,
            cell: (row) =>
              row.openWork.awaitingApproval > 0 ? (
                <Link
                  href={`/inbox?queue=awaiting_my_approval&clientId=${row.id}`}
                  className={countLinkClassName}
                >
                  {formatNumber(row.openWork.awaitingApproval)}
                </Link>
              ) : (
                <span className="text-ink-muted">0</span>
              ),
          },
          {
            id: "failed",
            header: "Failed",
            numeric: true,
            cell: (row) =>
              row.openWork.failed > 0 ? (
                <Link
                  href={`/inbox?queue=failed&clientId=${row.id}`}
                  className={cn(countLinkClassName, "text-danger-ink")}
                >
                  {formatNumber(row.openWork.failed)}
                </Link>
              ) : (
                <span className="text-ink-muted">0</span>
              ),
          },
          {
            id: "synced",
            header: "Last sync",
            cell: (row) => (
              <span className="text-caption text-ink-muted">
                {row.lastSyncAt ? formatRelativeTime(row.lastSyncAt) : "Never"}
              </span>
            ),
          },
        ]}
      />
    </HomeSection>
  )
}

export { WorkByClient }
