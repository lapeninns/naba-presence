"use client"

import { Link2 } from "lucide-react"
import { useId, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { describeActionError } from "@/lib/errors/action-errors"
import type { ConnectionSummary } from "@/lib/api/connections"
import type { StatusTone } from "@/lib/ui/status-tone"

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Connected", tone: "healthy" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  revoked: { label: "Access revoked", tone: "attention" },
  expired: { label: "Access expired", tone: "attention" },
}

function connectionStatus(connection: ConnectionSummary): {
  label: string
  tone: StatusTone
} {
  if (connection.reconnectRequired)
    return { label: "Needs reconnecting", tone: "at-risk" }
  return (
    STATUS[connection.status] ?? { label: connection.status, tone: "neutral" }
  )
}

/**
 * The Google logins this agency holds, one row each: who it is, which
 * clients depend on it, whether it still works, and the two things you can
 * do about it. Reconnect is a plain action on the row that needs it;
 * Disconnect is the destructive one and asks first.
 */
export function ConnectionCard({
  clientsByConnection,
}: {
  /**
   * Which clients each connection serves, keyed by connection id. When given,
   * every row says who it would break — disconnecting is an informed
   * decision, not a guess.
   */
  clientsByConnection?: ReadonlyMap<string, { id: string; name: string }[]>
} = {}) {
  const { query, connect, disconnect } = useConnectionWorkspace()
  const [pendingDisconnect, setPendingDisconnect] =
    useState<ConnectionSummary | null>(null)
  const headingId = useId()

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your connections"
        description={describeActionError(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const connections = query.data.connections

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-title font-semibold text-ink">
        Google account
      </h2>
      {connections.length === 0 ? (
        <Empty
          icon={<Link2 />}
          title="No Google account connected"
          description="Connect a Google Business Profile to import locations and manage reviews."
          action={
            <Button
              pill
              disabled={connect.isPending}
              onClick={() => connect.mutate({})}
            >
              Connect Google Business Profile
            </Button>
          }
        />
      ) : (
        <>
          {clientsByConnection ? (
            <h2 className="text-ui font-semibold text-ink">
              Who depends on each account
            </h2>
          ) : null}
          <GroupedList
            aria-label="Connected Google accounts"
            footer={
              clientsByConnection
                ? "Disconnecting an account stops reviews syncing for every client that uses it."
                : undefined
            }
          >
            {connections.map((connection) => {
              const name = connection.googleEmail ?? "Google account"
              const status = connectionStatus(connection)
              const served = clientsByConnection?.get(connection.id)
              return (
                <GroupedListItem
                  key={connection.id}
                  icon={<Link2 />}
                  label={name}
                  description={
                    served === undefined
                      ? undefined
                      : served.length === 0
                        ? "No clients use this account yet."
                        : `Used by ${served.map((client) => client.name).join(", ")}.`
                  }
                  trailing={
                    <>
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      {connection.reconnectRequired ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-accent-ink"
                          disabled={connect.isPending}
                          aria-label={`Reconnect ${name}`}
                          onClick={() => connect.mutate({})}
                        >
                          Reconnect
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-ink"
                        disabled={
                          disconnect.isPending ||
                          connection.status === "disconnected"
                        }
                        aria-label={`Disconnect ${name}`}
                        onClick={() => setPendingDisconnect(connection)}
                      >
                        Disconnect
                      </Button>
                    </>
                  }
                />
              )
            })}
          </GroupedList>
          <div>
            <Button
              variant="secondary"
              pill
              disabled={connect.isPending}
              onClick={() => connect.mutate({})}
            >
              Connect another account
            </Button>
          </div>
        </>
      )}

      <OverwriteConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null)
        }}
        title={`Disconnect ${pendingDisconnect?.googleEmail ?? "this Google account"}?`}
        description="Reviews and publishing stop immediately. Linked locations and notifications are deactivated, and the account’s data is permanently removed after 7 days."
        confirmLabel="Disconnect"
        requireAcknowledgement
        acknowledgementLabel="I understand this deactivates linked locations and purges the data after 7 days."
        pending={disconnect.isPending}
        onConfirm={() => {
          if (pendingDisconnect) {
            disconnect.mutate(pendingDisconnect.id, {
              onSuccess: () => setPendingDisconnect(null),
            })
          }
        }}
      />
    </section>
  )
}
