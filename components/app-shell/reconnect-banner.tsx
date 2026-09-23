"use client"

import { Unlink } from "lucide-react"
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
 * On org-wide pages this renders nothing; the Inbox's Today strip and the
 * clients list carry those clients, each with its own fix.
 *
 * Drawn as the reference's full-bleed banner directly under the toolbar: a
 * danger tint across the content column, inside the page gutters, with the
 * one action as a secondary button.
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
    <div
      role="alert"
      data-slot="reconnect-banner"
      className={cn(
        "flex shrink-0 flex-wrap items-start gap-3 bg-danger-tint px-5 py-2.5 text-ui text-ink sm:items-center md:px-(--np-page-pad-x)",
        className
      )}
    >
      <Unlink
        className="mt-0.5 size-4 shrink-0 text-danger-ink sm:mt-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-[1_1_16rem] text-pretty [overflow-wrap:anywhere]">
        <strong className="font-semibold">
          {client.name}: Google needs reconnecting.
        </strong>{" "}
        <span className="text-ink-secondary">
          {broken?.googleEmail
            ? `Reviews and profile changes for ${client.name} stopped syncing because ${broken.googleEmail} needs reconnecting.`
            : `Reviews and profile changes for ${client.name} are not syncing with Google.`}
          {lastRefresh ? ` Last successful sync: ${lastRefresh}.` : ""}
        </span>
      </p>
      <Link
        href={`/clients/${client.id}`}
        prefetch={false}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "shrink-0 pointer-coarse:min-h-11"
        )}
      >
        Reconnect Google
      </Link>
    </div>
  )
}
