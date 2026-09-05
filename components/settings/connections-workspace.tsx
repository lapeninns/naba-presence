"use client"

import Link from "next/link"

import { ConnectionCard } from "@/components/settings/connection-card"
import { NotificationsCard } from "@/components/settings/notifications-card"
import { OAuthReturn } from "@/components/settings/oauth-return"
import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import { buttonVariants } from "@/components/ui/button"
import { useClients } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

/**
 * The Google logins this agency holds, and which clients each one serves.
 *
 * Deliberately no longer the whole setup flow. This page used to be a stack of
 * cards — connect, pick accounts, discover locations, import history, enable
 * notifications — revealed one after another with no order, no progress and no
 * notion of which client any of it was for. Those steps moved to `/setup`,
 * where they run in sequence against a named client and can be resumed.
 *
 * What stays here is the account-level view: what is connected, what is
 * broken, and who depends on it — one grouped list, one row per account.
 */
export function ConnectionsWorkspace() {
  const { query } = useConnectionWorkspace()
  const clients = useClients()
  const hasConnection = (query.data?.connections.length ?? 0) > 0

  // Which clients each login serves, so disconnecting is an informed decision
  // rather than a guess about who it will break.
  const clientsByConnection = new Map<string, { id: string; name: string }[]>()
  for (const client of clients.data?.items ?? []) {
    for (const connection of client.connections) {
      const list = clientsByConnection.get(connection.id) ?? []
      list.push({ id: client.id, name: client.name })
      clientsByConnection.set(connection.id, list)
    }
  }

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <OAuthReturn />
      <ReconnectAlert />
      <ConnectionCard clientsByConnection={clientsByConnection} />

      {hasConnection ? <NotificationsCard /> : null}

      <section
        aria-labelledby="connection-setup"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="connection-setup"
            className="text-title font-semibold text-ink"
          >
            Setting up a client
          </h2>
          <p className="text-ui text-ink-muted">
            Choosing Business Profile accounts, linking locations and importing
            review history all happen per client, in order, where you can stop
            and come back.
          </p>
        </div>
        <div>
          <Link
            href="/clients/new"
            className={buttonVariants({ variant: "secondary", pill: true })}
          >
            Set up a client
          </Link>
        </div>
      </section>
    </div>
  )
}
