"use client"

import { CircleCheckIcon, Link2Icon } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
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
  const [starting, setStarting] = React.useState(false)
  const [startingFor, setStartingFor] = React.useState<string | null>(null)
  const [startError, setStartError] = React.useState<string | null>(null)
  const [attachError, setAttachError] = React.useState<string | null>(null)

  const returned = params.get("google")
  const returnedStatus = params.get("status")
  const requestId = params.get("rid")
  const returnedReason = params.get("reason")

  const connections = workspace.query.data?.connections ?? []
  const usable = connections.filter(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )

  const connect = async (reconnectConnectionId?: string) => {
    setStarting(true)
    setStartingFor(reconnectConnectionId ?? null)
    setStartError(null)
    try {
      const { authorizationUrl } = await startGoogleConnect({
        clientId,
        // Straight back into setup, not to a settings page the operator never
        // asked for: the next step after a fresh sign-in, or this step after
        // a reconnect, where the renewed login can then be used.
        returnTo: reconnectConnectionId
          ? `/setup?client=${clientId}&step=connect`
          : `/setup?client=${clientId}&step=account`,
        ...(reconnectConnectionId ? { reconnectConnectionId } : {}),
      })
      window.location.assign(authorizationUrl)
    } catch (error) {
      setStarting(false)
      setStartingFor(null)
      setStartError(describeActionError(error))
    }
  }

  const pickExisting = (connectionId: string) => {
    setAttachError(null)
    attachConnection.mutate(
      { clientId, connectionId },
      {
        onSuccess: onConnected,
        onError: (error) => setAttachError(describeActionError(error)),
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
              onClick={() => void connect()}
              pending={starting && startingFor === null}
              pendingLabel="Opening Google…"
              disabled={starting}
              className="self-start @min-[520px]/wiz:self-center"
            >
              Sign in with Google
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
            {attachError ? (
              <Alert variant="destructive" data-testid="setup-attach-error">
                <AlertTitle>Couldn’t use that account</AlertTitle>
                <AlertDescription>{attachError}</AlertDescription>
              </Alert>
            ) : null}
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
                            Reconnect it to use it here. Google opens, then you
                            come straight back to this step.
                          </span>
                        ) : null}
                      </div>
                      {broken ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusPill tone="bad">Needs reconnecting</StatusPill>
                          {/* Same reconnect as Settings' connection card:
                              target this login so Google pre-fills it and
                              the callback renews it rather than adding one. */}
                          <Button
                            size="sm"
                            variant="secondary"
                            pending={starting && startingFor === connection.id}
                            pendingLabel="Opening Google…"
                            disabled={starting}
                            onClick={() => void connect(connection.id)}
                            aria-label={`Reconnect ${connection.googleEmail ?? "this Google account"}`}
                          >
                            Reconnect
                          </Button>
                        </span>
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
