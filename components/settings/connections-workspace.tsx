"use client"

import { Plus } from "lucide-react"
import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ConnectionCard } from "@/components/settings/connection-card"
import { NotificationsCard } from "@/components/settings/notifications-card"
import { OAuthReturn } from "@/components/settings/oauth-return"
import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import { SettingsNav } from "@/components/settings/settings-nav"
import { Button, buttonVariants } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { useClients } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { cn } from "@/lib/utils"

/**
 * The Google logins this agency holds, and which clients each one serves
 * (reference `settings-connections.html`).
 *
 * Deliberately not the whole setup flow. This page used to be a stack of
 * cards — connect, pick accounts, discover locations, import history, enable
 * notifications — revealed one after another with no order, no progress and no
 * notion of which client any of it was for. Those steps moved to `/setup`,
 * where they run in sequence against a named client and can be resumed.
 *
 * What stays here is the account-level view: what is connected, what is
 * broken, who depends on it, and how Google tells us about new reviews.
 */
export function ConnectionsWorkspace({ role }: { role: string | null }) {
  const { query, connect } = useConnectionWorkspace()
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
    <>
      <PageHeader
        title="Google connections"
        description="The Google accounts this agency has connected, which clients depend on each, and how Google tells us about new reviews."
        actions={
          hasConnection ? (
            <Button
              variant="secondary"
              pending={connect.isPending}
              pendingLabel="Opening Google…"
              onClick={() => connect.mutate({})}
            >
              <Plus aria-hidden />
              Connect another account
            </Button>
          ) : undefined
        }
        tabs={<SettingsNav role={role} />}
      />

      <OAuthReturn />
      <ReconnectAlert clientsByConnection={clientsByConnection} />

      <section
        aria-labelledby="connection-logins"
        className="flex flex-col gap-3"
      >
        <SectionHeader
          id="connection-logins"
          title="Google accounts"
          description="Disconnecting an account stops reviews syncing for every client that uses it."
        />
        <ConnectionCard clientsByConnection={clientsByConnection} />
      </section>

      {hasConnection ? <NotificationsCard /> : null}

      <section
        aria-labelledby="connection-setup"
        className="flex flex-col gap-3"
      >
        <SectionHeader
          id="connection-setup"
          title="Setting up a client"
          description="Choosing Business Profile accounts, linking locations and importing review history all happen per client, in order, where you can stop and come back."
        />
        <div>
          <Link
            href="/clients/new"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Set up a client
          </Link>
        </div>
      </section>
    </>
  )
}
