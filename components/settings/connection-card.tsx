"use client"

import {
  CircleCheck,
  ExternalLink,
  Globe,
  Info,
  Link2,
  RefreshCw,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { describeActionError } from "@/lib/errors/action-errors"
import type { ConnectionSummary } from "@/lib/api/connections"
import type { StatusTone } from "@/lib/ui/status-tone"

type ServedClient = { id: string; name: string }

const STATUS: Record<string, { label: string; tone: StatusTone | PillTone }> = {
  active: { label: "Connected", tone: "ok" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  revoked: { label: "Access revoked", tone: "warn" },
  expired: { label: "Access expired", tone: "warn" },
}

function connectionStatus(connection: ConnectionSummary): {
  label: string
  tone: StatusTone | PillTone
} {
  if (connection.reconnectRequired)
    return { label: "Needs reconnecting", tone: "bad" }
  return (
    STATUS[connection.status] ?? { label: connection.status, tone: "neutral" }
  )
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Never"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function joinNames(clients: ServedClient[] | undefined): string {
  const names = (clients ?? []).map((client) => client.name)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * What reconnecting does, before Google opens (reference `#reconnect`).
 * Google identifies the login you sign in with: the same one updates this
 * connection; a different one is added beside it (the callback upserts on
 * the Google account's subject).
 */
export function ReconnectDialog({
  connection,
  served,
  open,
  onOpenChange,
}: {
  connection: ConnectionSummary | null
  served: ServedClient[] | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { connect } = useConnectionWorkspace()
  const email = connection?.googleEmail ?? "this Google login"
  const names = joinNames(served)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            Reconnect {email}
          </DialogTitle>
          <DialogDescription>
            Google opens and asks you to sign in. Which login you choose there
            decides what happens next.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="gap-3">
          <div className="flex flex-col gap-1 rounded-(--np-radius-control) bg-surface-alt px-3.5 py-3">
            <p className="flex items-center gap-2 text-body font-semibold text-ink">
              <CircleCheck
                className="size-4 shrink-0 text-success-ink"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="[overflow-wrap:anywhere]">
                Sign in as {email}: the same login
              </span>
            </p>
            <p className="text-ui text-ink-secondary">
              Google asks that login to approve access again, and this
              connection picks up where it stopped
              {names ? ` for ${names}` : ""}.
            </p>
          </div>
          <div className="flex flex-col gap-1 rounded-(--np-radius-control) bg-surface-alt px-3.5 py-3">
            <p className="flex items-center gap-2 text-body font-semibold text-ink">
              <Info
                className="size-4 shrink-0 text-info-ink"
                strokeWidth={1.75}
                aria-hidden
              />
              Sign in with a different Google login
            </p>
            <p className="text-ui text-ink-secondary">
              It’s added as a separate connection, not a replacement. This one
              keeps its warning until it is reconnected or disconnected.
            </p>
          </div>
          <p className="text-caption text-ink-muted">
            We never see your Google password. You can remove NabaPresence’s
            access at any time from your Google account.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            pending={connect.isPending}
            pendingLabel="Opening Google…"
            onClick={() => connect.mutate({})}
          >
            <ExternalLink aria-hidden />
            Continue to Google
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Disconnect, with its consequences laid out in order and an
 * acknowledgement before the button arms (reference `#disconnect`).
 */
function DisconnectDialog({
  connection,
  served,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  connection: ConnectionSummary | null
  served: ServedClient[] | undefined
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [ack, setAck] = useState(false)
  const email = connection?.googleEmail ?? "this Google account"
  const names = joinNames(served)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setAck(false)
      }}
    >
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        <AlertDialogTitle className="[overflow-wrap:anywhere]">
          Disconnect {email}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          Reviews and publishing stop immediately
          {names ? ` for ${names}` : ""}.
        </AlertDialogDescription>
        <ol className="flex flex-col gap-2 text-ui text-ink">
          <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2.5">
            <span className="font-mono text-caption text-ink-muted">Now</span>
            <span>
              Linked locations and notifications are deactivated. Nothing can
              publish through this login.
            </span>
          </li>
          <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2.5">
            <span className="font-mono text-caption text-ink-muted">
              After 7 days
            </span>
            <span>
              The account’s data is permanently removed. This can’t be undone.
            </span>
          </li>
        </ol>
        <Checkbox
          checked={ack}
          onCheckedChange={(value) => setAck(value === true)}
          label="I understand this deactivates linked locations and purges the data after 7 days."
        />
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="ghost">Keep it connected</Button>}
          />
          <Button
            variant="danger"
            disabled={!ack}
            pending={pending}
            pendingLabel="Disconnecting…"
            onClick={onConfirm}
          >
            Disconnect
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The Google logins this agency holds (reference `logins-table`): who it
 * is, whether it still works, which clients depend on it, when it last
 * refreshed and whether Google notifications are on — with Reconnect on a
 * broken row and Disconnect behind a confirmation.
 *
 * `?reconnect=<connection id>` marks that row and opens the reconnect
 * dialog once, for links from a client's "Google needs reconnecting" banner.
 */
export function ConnectionCard({
  clientsByConnection,
}: {
  /**
   * Which clients each connection serves, keyed by connection id. When given,
   * every row says who it would break — disconnecting is an informed
   * decision, not a guess.
   */
  clientsByConnection?: ReadonlyMap<string, ServedClient[]>
} = {}) {
  const { query, connect, disconnect } = useConnectionWorkspace()
  // Null outside the app router (component tests render it bare).
  const params = useSearchParams() as URLSearchParams | null
  const focusId = params?.get("reconnect") ?? null
  const [reconnectTarget, setReconnectTarget] =
    useState<ConnectionSummary | null>(null)
  const [reconnectOpen, setReconnectOpen] = useState(false)
  const [disconnectTarget, setDisconnectTarget] =
    useState<ConnectionSummary | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const openedFor = useRef<string | null>(null)

  const connections = query.data?.connections
  const focused = focusId
    ? (connections?.find((connection) => connection.id === focusId) ?? null)
    : null

  useEffect(() => {
    if (!focused || openedFor.current === focused.id) return
    openedFor.current = focused.id
    setReconnectTarget(focused)
    setReconnectOpen(true)
  }, [focused])

  if (query.isPending) {
    return (
      <Card flush aria-busy="true" className="divide-y divide-line">
        <span className="sr-only" role="status">
          Loading connections
        </span>
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 p-3.5">
            <Skeleton className="size-8 rounded-(--np-radius-control)" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your connections</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)} Syncing carries on in the
          background; nothing was changed.
        </AlertDescription>
        <AlertActions>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  }

  const rows = query.data.connections

  if (rows.length === 0) {
    return (
      <Card flush>
        <Empty
          icon={<Link2 />}
          title="No Google account connected"
          description="Connect a Google login that manages your clients’ Business Profiles to import locations and reviews."
          action={
            <Button
              pending={connect.isPending}
              pendingLabel="Opening Google…"
              onClick={() => connect.mutate({})}
            >
              Connect Google Business Profile
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <>
      {focusId && !focused ? (
        <Alert variant="info">
          <AlertTitle>That Google login isn’t connected here</AlertTitle>
          <AlertDescription>
            The link pointed at a login this agency no longer has. Every
            connected login is listed below.
          </AlertDescription>
        </Alert>
      ) : null}
      <Table surface responsive aria-label="Connected Google accounts">
        <TableHeader>
          <TableRow>
            <TableHead>Google login</TableHead>
            <TableHead>Status</TableHead>
            {clientsByConnection ? (
              <TableHead>Clients it serves</TableHead>
            ) : null}
            <TableHead>Last refresh</TableHead>
            <TableHead>Notifications</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((connection) => {
            const name = connection.googleEmail ?? "Google account"
            const status = connectionStatus(connection)
            const served = clientsByConnection?.get(connection.id)
            const isFocused = connection.id === focused?.id
            return (
              <TableRow
                key={connection.id}
                data-selected={isFocused || undefined}
                className={
                  isFocused
                    ? "[&>td:first-child]:shadow-[inset_3px_0_0_var(--np-accent)]"
                    : undefined
                }
              >
                <TableCell label="Google login">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-(--np-radius-control) bg-fill text-ink-secondary"
                    >
                      <Globe className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 font-semibold [overflow-wrap:anywhere] text-ink">
                      {name}
                    </span>
                  </span>
                </TableCell>
                <TableCell label="Status">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </TableCell>
                {clientsByConnection ? (
                  <TableCell label="Clients it serves" span>
                    {served && served.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {served.map((client) => (
                          <Link
                            key={client.id}
                            href={`/clients/${client.id}`}
                            className="inline-flex h-6 items-center rounded-(--np-radius-pill) border border-line px-2 text-caption whitespace-nowrap text-ink no-underline focus-halo hover:border-line-strong hover:bg-surface-alt pointer-coarse:h-8"
                          >
                            {client.name}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span className="text-caption text-ink-muted">
                        No clients use this account yet.
                      </span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell label="Last refresh">
                  <span className="font-mono text-caption whitespace-nowrap text-ink-muted tabular-nums">
                    {formatWhen(connection.lastRefreshAt)}
                  </span>
                </TableCell>
                <TableCell label="Notifications">
                  {connection.reconnectRequired ? (
                    <StatusPill tone="warn">Paused</StatusPill>
                  ) : connection.notificationsEnabled &&
                    connection.status === "active" ? (
                    <StatusPill tone="ok">On</StatusPill>
                  ) : (
                    <StatusPill tone="neutral" plain>
                      Off
                    </StatusPill>
                  )}
                </TableCell>
                <TableCell data-actions="" className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5 @max-[720px]/table:justify-start">
                    {connection.reconnectRequired ? (
                      <Button
                        size="sm"
                        aria-label={`Reconnect ${name}`}
                        onClick={() => {
                          setReconnectTarget(connection)
                          setReconnectOpen(true)
                        }}
                      >
                        Reconnect
                      </Button>
                    ) : null}
                    {connection.status !== "disconnected" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-ink"
                        disabled={disconnect.isPending}
                        aria-label={`Disconnect ${name}`}
                        onClick={() => {
                          setDisconnectTarget(connection)
                          setDisconnectOpen(true)
                        }}
                      >
                        Disconnect
                      </Button>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <ReconnectDialog
        connection={reconnectTarget}
        served={
          reconnectTarget
            ? clientsByConnection?.get(reconnectTarget.id)
            : undefined
        }
        open={reconnectOpen}
        onOpenChange={setReconnectOpen}
      />
      <DisconnectDialog
        key={disconnectTarget?.id ?? "none"}
        connection={disconnectTarget}
        served={
          disconnectTarget
            ? clientsByConnection?.get(disconnectTarget.id)
            : undefined
        }
        open={disconnectOpen}
        pending={disconnect.isPending}
        onOpenChange={setDisconnectOpen}
        onConfirm={() => {
          if (disconnectTarget) {
            disconnect.mutate(disconnectTarget.id, {
              onSuccess: () => setDisconnectOpen(false),
            })
          }
        }}
      />
    </>
  )
}
