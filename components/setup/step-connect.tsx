"use client"

import { CircleCheckIcon, Link2Icon } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { startGoogleConnect } from "@/lib/api/connections"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatRelativeTime } from "@/lib/format"
import { useClientMutations } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { describeGoogleConnectStatus } from "@/lib/setup/oauth-status"

/**
 * Choose the Google login that manages this client's Business Profile.
 *
 * Two routes, because an agency has both: the first client needs a fresh
 * consent, and the tenth is usually on a login the agency already connected.
 * Offering only the first would send an operator through Google's consent
 * screen for an account already sitting in the list.
 *
 * Errors are the real ones: a refused `connect/start` (Google not configured,
 * no permission) and, when the callback returns here, its `?google=error`
 * status and request id. Nothing is invented for the error state.
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
  const params = useSearchParams()
  const workspace = useConnectionWorkspace()
  const { attachConnection } = useClientMutations()
  const toast = useToastManager()
  const [starting, setStarting] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)

  const returned = params.get("google")
  const returnedStatus = params.get("status")
  const requestId = params.get("rid")
  const returnedReason = params.get("reason")

  const connections = workspace.query.data?.connections ?? []
  const usable = connections.filter(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )

  const connect = async () => {
    setStarting(true)
    setStartError(null)
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
      setStartError(describeActionError(error))
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
      pendingLabel="Loading your Google connections"
      error="We couldn't load your Google connections"
      onRetry={() => void workspace.query.refetch()}
    >
      {() => (
        <div className="flex flex-col gap-4">
          {startError || returned === "error" ? (
            <Alert variant="destructive" data-testid="setup-connect-error">
              <AlertTitle>
                {!startError && returnedReason === "google_scope_missing"
                  ? "Permission not granted"
                  : "Google didn’t connect"}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-1">
                <span>
                  {startError ??
                    describeGoogleConnectStatus(returnedStatus, returnedReason)}
                </span>
                {!startError && requestId ? (
                  <span className="text-caption text-ink-muted">
                    Reference{" "}
                    <code className="rounded-(--np-radius-tag) bg-surface px-1 font-mono text-caption">
                      {requestId}
                    </code>
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {returned === "connected" && !startError ? (
            <Alert variant="success" icon={<CircleCheckIcon aria-hidden />}>
              <AlertTitle>Google account connected</AlertTitle>
              <AlertDescription>
                Continue to choose which Business Profile accounts belong to{" "}
                {clientName}.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-3.5 @min-[520px]/wiz:flex-row @min-[520px]/wiz:items-center">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-(--np-radius-control) bg-fill text-ink-secondary [&_svg]:size-4"
            >
              <Link2Icon strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="text-body font-semibold text-ink">
                Connect a Google account
              </h3>
              <p className="text-ui text-ink-muted">
                Sign in to the Google account that manages {clientName}’s
                Business Profile. You’ll sign in on Google’s own page and come
                straight back to the next step.
              </p>
            </div>
            <Button
              id="setup-connect-google"
              variant={usable.length === 0 ? "default" : "secondary"}
              onClick={connect}
              pending={starting}
              pendingLabel="Opening Google…"
              className="self-start @min-[520px]/wiz:self-center"
            >
              Continue with Google
            </Button>
          </div>

          <section
            aria-labelledby="setup-connected-logins"
            className="flex flex-col gap-2"
          >
            <h3
              id="setup-connected-logins"
              className="font-mono text-[0.71875rem] leading-4 font-medium tracking-[0.06em] text-ink-muted uppercase"
            >
              Use an account already connected
            </h3>
            {connections.length === 0 ? (
              <p className="text-ui text-ink-muted">
                You haven’t connected a Google account yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {connections.map((connection) => {
                  const broken =
                    connection.reconnectRequired ||
                    connection.status !== "active"
                  return (
                    <li
                      key={connection.id}
                      className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-(--np-radius-card) border border-line bg-surface p-3.5"
                    >
                      <span
                        aria-hidden
                        className="grid size-8 shrink-0 place-items-center rounded-(--np-radius-control) bg-fill text-ui font-semibold text-ink-secondary"
                      >
                        G
                      </span>
                      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5">
                        <span className="text-body font-semibold [overflow-wrap:anywhere] text-ink">
                          {connection.googleEmail ?? "Google account"}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {connection.lastRefreshAt
                            ? `Refreshed ${formatRelativeTime(connection.lastRefreshAt)}`
                            : "Not refreshed yet"}
                        </span>
                        {broken ? (
                          <span className="text-caption text-ink-muted">
                            <Link
                              href="/settings/connections"
                              className="rounded-(--np-radius-tag) font-medium text-accent-ink underline underline-offset-3 focus-halo"
                            >
                              Reconnect it in Settings
                            </Link>{" "}
                            to use it here.
                          </span>
                        ) : null}
                      </div>
                      {broken ? (
                        <StatusPill tone="bad">Needs reconnecting</StatusPill>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusPill tone="ok">Connected</StatusPill>
                          <Button
                            size="sm"
                            variant="secondary"
                            pending={
                              attachConnection.isPending &&
                              attachConnection.variables?.connectionId ===
                                connection.id
                            }
                            pendingLabel="Using…"
                            disabled={attachConnection.isPending}
                            onClick={() => pickExisting(connection.id)}
                            aria-label={`Use ${connection.googleEmail ?? "this Google account"}`}
                          >
                            Use this account
                          </Button>
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {usable.length > 0 ? (
              <p className="text-caption text-ink-muted">
                Choose “Use this account” to use a connected account for{" "}
                {clientName}, then pick its Business Profile accounts.
              </p>
            ) : null}
          </section>

          <p className="text-caption text-ink-muted">
            NabaPresence reads reviews, replies to them and edits the profile
            fields you approve. Nothing reaches Google until a person approves
            it.
          </p>
        </div>
      )}
    </QueryStates>
  )
}

export { StepConnect }
