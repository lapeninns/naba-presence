"use client"

import Link from "next/link"

import { ConnectionCard } from "@/components/settings/connection-card"
import { NotificationsCard } from "@/components/settings/notifications-card"
import { OAuthReturn } from "@/components/settings/oauth-return"
import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import { buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { healthTone } from "@/lib/clients/health"
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
 * broken, and who depends on it.
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
    <div className="flex flex-col gap-8">
      <OAuthReturn />
      <ReconnectAlert />
      <ConnectionCard />

      {hasConnection ? (
        <section aria-labelledby="connection-clients" className="flex flex-col gap-3">
          <div>
            <h2 id="connection-clients" className="text-section">
              Who depends on each account
            </h2>
            <p className="text-ui text-ink-muted">
              Disconnecting a Google account stops reviews syncing for every
              client below it.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {(query.data?.connections ?? []).map((connection) => {
              const served = clientsByConnection.get(connection.id) ?? []
              return (
                <li
                  key={connection.id}
                  className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium">
                      {connection.googleEmail ?? "Google account"}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {served.length === 0
                        ? "No clients use this account yet."
                        : `Used by ${served.map((client) => client.name).join(", ")}.`}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      connection.reconnectRequired || connection.status !== "active"
                        ? healthTone("disconnected")
                        : healthTone("healthy")
                    }
                  >
                    {connection.reconnectRequired || connection.status !== "active"
                      ? "Needs reconnecting"
                      : "Connected"}
                  </StatusPill>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {hasConnection ? <NotificationsCard /> : null}

      <section aria-labelledby="connection-setup" className="flex flex-col gap-2">
        <h2 id="connection-setup" className="text-section">
          Setting up a client
        </h2>
        <p className="text-ui text-ink-muted">
          Choosing Business Profile accounts, linking locations and importing
          review history all happen per client, in order, where you can stop and
          come back.
        </p>
        <div>
          <Link
            href="/clients/new"
            className={buttonVariants({ variant: "outline" })}
          >
            Set up a client
          </Link>
        </div>
      </section>
    </div>
  )
}
