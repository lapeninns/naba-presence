"use client"

import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { useClients } from "@/lib/queries/use-clients"

import { useClientScope } from "./client-context"

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleString("en-GB")
}

/**
 * A reconnect prompt for the client the page is about.
 *
 * Client-scoped rather than shell-wide. The old banner sat on every page of
 * the app whenever ANY connection was unhealthy, which for an agency means a
 * permanent red bar naming no one: it neither said which client was affected
 * nor gave an action that helped the client actually in front of you.
 *
 * On org-wide pages this renders nothing. Home's attention list carries those
 * clients instead, where each row can name its own client and its own fix.
 */
export function ReconnectBanner() {
  const clientId = useClientScope()
  const clients = useClients()

  if (!clientId) return null
  const client = clients.data?.items.find((entry) => entry.id === clientId)
  if (!client) return null
  if (client.health !== "disconnected" && client.health !== "not_connected") {
    return null
  }
  // A client with nothing linked yet is mid-setup, not broken. The fix is to
  // finish the wizard, and a destructive alert would misdescribe it.
  if (client.health === "not_connected" && client.linkedCount === 0) return null

  const broken =
    client.connections.find((connection) => connection.reconnectRequired) ??
    client.connections.find((connection) => connection.status !== "active") ??
    null
  const lastRefresh = formatWhen(broken?.lastRefreshAt)

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{client.name}: Google needs reconnecting</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {broken?.googleEmail
            ? `Reviews and profile changes for ${client.name} stopped syncing because ${broken.googleEmail} needs reconnecting.`
            : `Reviews and profile changes for ${client.name} are not syncing with Google.`}
          {lastRefresh ? ` Last successful sync: ${lastRefresh}.` : ""}
        </span>
        <Link
          href={`/clients/${client.id}`}
          prefetch={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Reconnect
        </Link>
      </AlertDescription>
    </Alert>
  )
}
