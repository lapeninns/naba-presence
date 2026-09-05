"use client"

import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

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
 *
 * Visually a tinted warning card sitting at the top of the content column,
 * inside the page's own gutters, with a plain (accent-text) action. Nothing
 * else in the shell is red or bordered, and this should not be either: it is
 * a card with a colour, not an alarm.
 */
export function ReconnectBanner({ className }: { className?: string }) {
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
    <div className={cn("shrink-0", className)}>
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-(--np-radius-card) bg-warning-tint px-4 py-3 text-ui text-ink sm:flex-row sm:items-center"
      >
        <TriangleAlertIcon
          className="size-4 shrink-0 text-warning-ink"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-semibold">
            {client.name}: Google needs reconnecting
          </p>
          <p className="text-ink-muted">
            {broken?.googleEmail
              ? `Reviews and profile changes for ${client.name} stopped syncing because ${broken.googleEmail} needs reconnecting.`
              : `Reviews and profile changes for ${client.name} are not syncing with Google.`}
            {lastRefresh ? ` Last successful sync: ${lastRefresh}.` : ""}
          </p>
        </div>
        <Link
          href={`/clients/${client.id}`}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "shrink-0 self-start text-accent-ink sm:self-center"
          )}
        >
          Reconnect Google
        </Link>
      </div>
    </div>
  )
}
