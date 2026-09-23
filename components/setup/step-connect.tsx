"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { startGoogleConnect } from "@/lib/api/connections"
import { describeActionError } from "@/lib/errors/action-errors"
import { useClientMutations } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { cn } from "@/lib/utils"

/**
 * Choose the Google login that manages this client's Business Profile.
 *
 * Two routes, because an agency has both: the first client needs a fresh
 * consent, and the tenth is usually on a login the agency already connected.
 * Offering only the first would send an operator through Google's consent
 * screen for an account already sitting in the list.
 */
function StepConnect({
  clientId,
  clientName,
  onConnected,
}: {
  clientId: string
  clientName: string
  /** Called once an existing login is filed under the client. */
  onConnected: () => void
}) {
  const workspace = useConnectionWorkspace()
  const { attachConnection } = useClientMutations()
  const toast = useToastManager()
  const [starting, setStarting] = React.useState(false)

  const connections = workspace.query.data?.connections ?? []
  const usable = connections.filter(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )

  const connect = async () => {
    setStarting(true)
    try {
      const { authorizationUrl } = await startGoogleConnect({
        clientId,
        // Straight back to the next step, not to a settings page the operator
        // never asked for.
        returnTo: `/setup?client=${clientId}&step=account`,
      })
      window.location.assign(authorizationUrl)
    } catch (error) {
      setStarting(false)
      toast.add({
        title: "Could not start the connection",
        description: describeActionError(error),
      })
    }
  }

  const pickExisting = (connectionId: string) => {
    attachConnection.mutate(
      { clientId, connectionId },
      {
        onSuccess: onConnected,
        onError: (error) =>
          toast.add({
            title: "Could not use that account",
            description: describeActionError(error),
          }),
      }
    )
  }

  return (
    <QueryStates
      status={
        workspace.query.isPending
          ? "pending"
          : workspace.query.isError
            ? "error"
            : "ready"
      }
      error="We couldn't load your Google connections"
      onRetry={() => void workspace.query.refetch()}
    >
      {() => (
        <div className="grid gap-(--np-gap-card) lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-accent-tint p-(--np-card-pad)">
            <div className="flex flex-col gap-1">
              <h3 className="text-title font-semibold text-ink">
                Connect a Google account
              </h3>
              <p className="text-ui text-ink-muted">
                Sign in to the Google account that manages {clientName}&rsquo;s
                Business Profile. You&rsquo;ll be sent to Google and brought
                straight back here.
              </p>
            </div>
            <Button
              pill
              onClick={connect}
              disabled={starting}
              className="self-start"
            >
              {starting ? "Opening Google…" : "Continue with Google"}
            </Button>
          </div>

          <div
            className={cn(
              "flex flex-col gap-3 rounded-(--np-radius-card) bg-surface-sunken p-(--np-card-pad)",
              usable.length === 0 && "opacity-60"
            )}
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-title font-semibold text-ink">
                Use an account already connected
              </h3>
              <p className="text-ui text-ink-muted">
                One Google login can manage several Business Profile accounts.
                {usable.length === 0
                  ? " You haven't connected one yet."
                  : " Pick one to skip the Google sign-in."}
              </p>
            </div>
            {connections.length > 0 ? (
              <ul className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-tag) bg-surface">
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    className="flex min-h-(--np-row-h) items-center gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-ui text-ink">
                      {connection.googleEmail ?? "Google account"}
                    </span>
                    {connection.reconnectRequired ||
                    connection.status !== "active" ? (
                      <StatusPill tone="at-risk">Needs reconnecting</StatusPill>
                    ) : (
                      <>
                        <StatusPill tone="healthy">Connected</StatusPill>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={attachConnection.isPending}
                          onClick={() => pickExisting(connection.id)}
                          aria-label={`Use ${connection.googleEmail ?? "this Google account"}`}
                        >
                          {attachConnection.isPending &&
                          attachConnection.variables?.connectionId ===
                            connection.id
                            ? "Using…"
                            : "Use this account"}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <p className="text-ui text-ink-muted lg:col-span-2">
            NabaPresence only reads and replies to reviews and edits the profile
            fields you approve. Nothing is published until a person approves it.
          </p>
        </div>
      )}
    </QueryStates>
  )
}

export { StepConnect }
