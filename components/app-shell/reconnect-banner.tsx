"use client"

import { KeyRound, Unlink } from "lucide-react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/format"
import { useClients } from "@/lib/queries/use-clients"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  useConnectionsQuery,
  useStartGoogleConnect,
} from "@/lib/queries/use-connection-workspace"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

import { useClientScope } from "./client-context"

const CAN_RECONNECT = new Set(["owner", "admin"])

/**
 * The organisation-wide "action needed" banner.
 *
 * Shown on every page whenever any Google login needs reconnecting --
 * including a login whose locations have since been unlinked, which the old
 * client-scoped banner lost track of. One sentence says what happened; for
 * owners and admins one button goes straight to Google with that login
 * pre-selected (login_hint) and comes back to this page, so a reconnect is
 * one click plus Google's own consent. Everyone else is told who can fix it
 * and gets no reconnect control.
 *
 * Inside a client whose listing lost manager access (not a login problem),
 * it says so instead: reconnecting would not help, the business has to
 * restore access.
 */
export function ReconnectBanner({ className }: { className?: string }) {
  const clientId = useClientScope()
  const clients = useClients()
  const role = useSessionRole()
  const query = useConnectionsQuery()
  const connect = useStartGoogleConnect()

  const broken = (query.data?.connections ?? []).filter(
    (connection) =>
      connection.reconnectRequired && connection.status !== "disconnected"
  )
  const scoped = clientId
    ? clients.data?.items.find((entry) => entry.id === clientId)
    : undefined

  if (broken.length === 0) {
    if (scoped?.freshness?.reason !== "listing_access_lost") return null
    const lost = scoped.checks?.accessLost ?? 0
    return (
      <Banner
        className={className}
        icon="access"
        message={
          <>
            <strong className="font-semibold">
              {scoped.name}: a listing can’t be reached.
            </strong>{" "}
            <span className="text-ink-secondary">
              The connected Google login lost manager access to{" "}
              {lost === 1
                ? "one of this client’s listings"
                : `${lost} of this client’s listings`}
              . Ask the business to add it back as a manager on Google; its
              other listings keep syncing.
            </span>
          </>
        }
      />
    )
  }

  const first = broken[0]
  const email = first.googleEmail ?? "a Google login"
  const others = broken.length - 1
  const canReconnect = role !== null && CAN_RECONNECT.has(role)
  const superseded = first.reconnectReason === "superseded_by_reconnect"
  const lastChecked = scoped?.freshness?.lastSuccessfulCheckAt

  return (
    <Banner
      className={className}
      icon="login"
      message={
        <>
          <strong className="font-semibold [overflow-wrap:anywhere]">
            {superseded
              ? `${email} still needs reconnecting.`
              : `Google stopped accepting ${email}.`}
          </strong>{" "}
          <span className="text-ink-secondary">
            {superseded
              ? "A different Google account was used last time, so this login is still paused. Reconnect it, or disconnect it in Settings."
              : "Reviews and profile changes it covers are paused until it is reconnected."}
            {lastChecked
              ? ` Last successful check ${formatRelativeTime(lastChecked)}.`
              : ""}
            {others > 0
              ? ` ${others} other Google ${others === 1 ? "login needs" : "logins need"} reconnecting too.`
              : ""}
            {canReconnect ? "" : " Ask an owner or admin to reconnect it."}
          </span>
          {connect.isError ? (
            <span className="block text-danger-ink">
              {describeActionError(connect.error)}
            </span>
          ) : null}
        </>
      }
      actions={
        canReconnect ? (
          <span className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="max-w-full pointer-coarse:min-h-11"
              pending={connect.isPending}
              pendingLabel="Opening Google…"
              // Straight to Google: the login is pre-selected and the
              // callback brings the person back to this page.
              onClick={() =>
                connect.mutate({
                  reconnectConnectionId: first.id,
                  returnTo: `${window.location.pathname}${window.location.search}`,
                })
              }
            >
              <span className="min-w-0 truncate">
                Reconnect {first.googleEmail ?? "Google"}
              </span>
            </Button>
            {others > 0 ? (
              <Link
                href="/settings/connections"
                prefetch={false}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "pointer-coarse:min-h-11"
                )}
              >
                See all
              </Link>
            ) : null}
          </span>
        ) : null
      }
    />
  )
}

function Banner({
  className,
  icon,
  message,
  actions,
}: {
  className?: string
  icon: "login" | "access"
  message: React.ReactNode
  actions?: React.ReactNode
}) {
  const Icon = icon === "login" ? Unlink : KeyRound
  return (
    <div
      // A standing condition, not an interruption: announced politely once,
      // not re-read as an alert on every page it persists across.
      role="status"
      data-slot="reconnect-banner"
      className={cn(
        "flex shrink-0 flex-wrap items-start gap-3 bg-danger-tint px-5 py-2.5 text-ui text-ink sm:items-center md:px-(--np-page-pad-x)",
        className
      )}
    >
      <Icon
        className="mt-0.5 size-4 shrink-0 text-danger-ink sm:mt-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-[1_1_16rem] text-pretty [overflow-wrap:anywhere]">
        {message}
      </p>
      {actions}
    </div>
  )
}
