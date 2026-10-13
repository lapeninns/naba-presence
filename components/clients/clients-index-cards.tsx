import Link from "next/link"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { Card } from "@/components/ui/card"
import { StatusPill } from "@/components/ui/status-pill"
import { clientHealthNote, healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Reviews someone has to act on: needs a reply, or a draft awaiting approval. */
export function openWorkCount(client: ClientSummary): number {
  return client.openWork.needsReply + client.openWork.awaitingApproval
}

/**
 * The one meta line under a client: how many listings, then what is wrong
 * when something is (the same note the desk table shows) or when it last
 * synced when nothing is.
 */
export function clientMetaLine(client: ClientSummary): string {
  const listings =
    client.locationCount === 0
      ? "No listings"
      : `${formatNumber(client.locationCount)} ${client.locationCount === 1 ? "listing" : "listings"}`
  const note = clientHealthNote(client)
  const tail =
    note ??
    (client.lastSyncAt
      ? `synced ${formatRelativeTime(client.lastSyncAt)}`
      : "not synced yet")
  return `${listings} · ${tail}`
}

/**
 * The Clients list on a phone: one record card per client, the whole card a
 * single link. Led by the name with the health word under it, one key
 * figure (open work) at the trailing edge and one meta line. The desk keeps
 * the table; both are rendered and CSS picks one, so nothing flashes on
 * hydration.
 */
export function ClientRecordList({
  clients,
  className,
}: {
  clients: readonly ClientSummary[]
  className?: string
}) {
  return (
    <Card flush className={className}>
      <ul aria-label="Clients" className="divide-y divide-line">
        {clients.map((client) => {
          const work = openWorkCount(client)
          const failed = client.openWork.failed
          return (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex min-h-(--np-touch) items-center gap-3 px-4 py-3 text-ink no-underline focus-halo transition-colors duration-(--np-duration-fast) hover:bg-surface-alt focus-visible:outline-none"
              >
                <ClientAvatar name={client.name} colour={client.colour} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="text-body font-semibold break-words text-ink">
                    {client.name}
                  </span>
                  <StatusPill
                    tone={healthTone(client.health)}
                    dashed={client.health === "not_connected"}
                  >
                    {healthLabel(client.health)}
                  </StatusPill>
                  <span className="text-caption text-ink-muted">
                    {clientMetaLine(client)}
                    {failed > 0 ? (
                      <span className="font-medium text-danger-ink">
                        {` · ${formatNumber(failed)} failed`}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-right">
                  <span
                    className={cn(
                      "font-mono text-title font-semibold tabular-nums",
                      work > 0 ? "text-ink" : "text-ink-muted"
                    )}
                  >
                    {formatNumber(work)}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {work === 1 ? "open review" : "open reviews"}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
