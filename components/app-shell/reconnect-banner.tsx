"use client"

import { KeyRound, Unlink, XIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { ReconnectDialogView } from "@/components/settings/connection-card"
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

/** The page that lists every connection with its own Reconnect. */
const CONNECTIONS_PATH = "/settings/connections"

const DISMISS_KEY = "np.reconnect-banner.dismissed"

// Dismissal is kept for the browser session and keyed on WHICH logins are
// broken, so a login that breaks later brings the banner back. Read through
// useSyncExternalStore: the server has no session storage, so its snapshot is
// "not dismissed" and hydration agrees before the stored value takes over.
const dismissListeners = new Set<() => void>()

function subscribeDismissed(listener: () => void) {
  dismissListeners.add(listener)
  return () => {
    dismissListeners.delete(listener)
  }
}

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

function writeDismissed(key: string) {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, key)
  } catch {
    // Blocked storage: the banner simply comes back on the next page.
  }
  for (const listener of dismissListeners) listener()
}

/**
 * The organisation-wide "action needed" banner.
 *
 * Shown whenever any Google login needs reconnecting -- including a login
 * whose locations have since been unlinked, which the old client-scoped
 * banner lost track of. One sentence says what happened; owners and admins
 * get Reconnect, which opens the same explanation Settings' connection card
 * shows (same login renews it, a different one is added beside it) and then
 * goes to Google with that login pre-selected, returning to this page.
 * Everyone else is told who can fix it and gets no reconnect control.
 *
 * Not shown on Settings › Google connections, which lists the same logins
 * with their own Reconnect. It can be dismissed for the session (the header
 * health chip keeps reporting the problem), and on a phone the explanation
 * folds away so the banner stays one line.
 *
 * Inside a client whose listing lost manager access (not a login problem),
 * it says so instead: reconnecting would not help, the business has to
 * restore access.
 */
export function ReconnectBanner({ className }: { className?: string }) {
  const pathname = usePathname()
  const clientId = useClientScope()
  const clients = useClients()
  const role = useSessionRole()
  const query = useConnectionsQuery()
  const connect = useStartGoogleConnect()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const dismissed = React.useSyncExternalStore(
    subscribeDismissed,
    readDismissed,
    () => null
  )

  const broken = (query.data?.connections ?? []).filter(
    (connection) =>
      connection.reconnectRequired && connection.status !== "disconnected"
  )
  const scoped = clientId
    ? clients.data?.items.find((entry) => entry.id === clientId)
    : undefined
  const dismissKey = broken
    .map((connection) => connection.id)
    .sort()
    .join(",")

  if (
    pathname === CONNECTIONS_PATH ||
    pathname?.startsWith(`${CONNECTIONS_PATH}/`)
  ) {
    return null
  }

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

  if (dismissed === dismissKey) return null

  const first = broken[0]
  const email = first.googleEmail ?? "a Google login"
  const others = broken.length - 1
  const canReconnect = role !== null && CAN_RECONNECT.has(role)
  const superseded = first.reconnectReason === "superseded_by_reconnect"
  const lastChecked = scoped?.freshness?.lastSuccessfulCheckAt

  return (
    <>
      <Banner
        className={className}
        icon="login"
        onDismiss={() => writeDismissed(dismissKey)}
        message={
          <>
            <strong className="font-semibold [overflow-wrap:anywhere]">
              {superseded
                ? `${email} still needs reconnecting.`
                : `Google stopped accepting ${email}.`}
            </strong>{" "}
            {/* The explanation folds away on a phone, where the banner
                would otherwise push the page a third of a screen down. */}
            <span className="text-ink-secondary max-sm:hidden">
              {superseded
                ? "A different Google account was used last time, so this login is still paused. Reconnect it, or disconnect it in Settings."
                : "Reviews and profile changes it covers are paused until it is reconnected."}
              {lastChecked
                ? ` Last successful check ${formatRelativeTime(lastChecked)}.`
                : ""}
              {others > 0
                ? ` ${others} other Google ${others === 1 ? "login needs" : "logins need"} reconnecting too.`
                : ""}
            </span>
            {canReconnect ? null : (
              <span className="text-ink-secondary">
                {" "}
                Ask an owner or admin to reconnect it.
              </span>
            )}
          </>
        }
        actions={
          canReconnect ? (
            <span className="flex min-w-0 flex-wrap items-center gap-2 sm:max-w-[28rem]">
              <Button
                variant="outline"
                size="sm"
                className="max-w-full min-w-0 justify-start overflow-hidden pointer-coarse:min-h-11"
                // The address is hidden on a phone; the name keeps it.
                aria-label={`Reconnect ${first.googleEmail ?? "Google"}`}
                onClick={() => {
                  connect.reset()
                  setDialogOpen(true)
                }}
              >
                <span className="block min-w-0 truncate">
                  Reconnect
                  <span className="max-sm:hidden">
                    {" "}
                    {first.googleEmail ?? "Google"}
                  </span>
                </span>
              </Button>
              {others > 0 ? (
                <Link
                  href={CONNECTIONS_PATH}
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
      {canReconnect ? (
        <ReconnectDialogView
          connection={first}
          served={undefined}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          pending={connect.isPending}
          error={connect.isError ? describeActionError(connect.error) : null}
          onContinue={() =>
            connect.mutate({
              reconnectConnectionId: first.id,
              // Back to the page the banner was on.
              returnTo: `${window.location.pathname}${window.location.search}`,
            })
          }
        />
      ) : null}
    </>
  )
}

function Banner({
  className,
  icon,
  message,
  actions,
  onDismiss,
}: {
  className?: string
  icon: "login" | "access"
  message: React.ReactNode
  actions?: React.ReactNode
  onDismiss?: () => void
}) {
  const Icon = icon === "login" ? Unlink : KeyRound
  return (
    <div
      // A standing condition, not an interruption: announced politely once,
      // not re-read as an alert on every page it persists across.
      role="status"
      data-slot="reconnect-banner"
      className={cn(
        "flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 bg-danger-tint px-5 py-2 text-ui text-ink sm:items-center sm:py-2.5 md:px-(--np-page-pad-x)",
        className
      )}
    >
      <Icon
        className="mt-0.5 size-4 shrink-0 text-danger-ink sm:mt-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-[1_1_12rem] text-pretty [overflow-wrap:anywhere]">
        {message}
      </p>
      {actions}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide until next session"
          title="Hide until next session. The health chip in the header still shows it."
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted focus-halo transition-colors hover:bg-fill hover:text-ink focus-visible:outline-none pointer-coarse:size-11"
        >
          <XIcon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
