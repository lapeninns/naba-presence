"use client"

import { CheckIcon, CircleCheckIcon, Link2Icon, XIcon } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { QueryStates } from "@/components/ui/query-states"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import { startGoogleConnect } from "@/lib/api/connections"
import { describeActionError } from "@/lib/errors/action-errors"
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
  business,
  onConnected,
}: {
  clientId: string
  clientName: string
  business: boolean
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
                    describeGoogleConnectStatus(
                      returnedStatus,
                      returnedReason,
                      business ? "business" : "agency"
                    )}
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
                {business ? "your business" : clientName}.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* The focused step (Notion Mail's "Connect" sheet, in page): a
              neutral tile, the ask, one full-width sign-in, then what the
              consent covers and what it never does. The scopes are the ones
              `lib/server/google/oauth.ts` requests (openid, email, profile,
              business.manage) and nothing more. */}
          <div className="flex max-w-lg flex-col items-start gap-4">
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-lg bg-fill text-ink [&_svg]:size-5"
            >
              <Link2Icon strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-title font-semibold text-ink">
                Connect a Google account
              </h3>
              <p className="text-body text-pretty text-ink-muted">
                Sign in to the Google account that manages{" "}
                {business ? "your" : `${clientName}’s`} Business Profile. You’ll
                sign in on Google’s own page and come straight back to the next
                step.
              </p>
            </div>
            <Button
              id="setup-connect-google"
              size="lg"
              block
              variant={usable.length === 0 ? "default" : "secondary"}
              onClick={() => void connect()}
              pending={starting && startingFor === null}
              pendingLabel="Opening Google…"
              disabled={starting}
            >
              Sign in with Google
            </Button>
            <div className="grid w-full gap-4 @min-[520px]/wiz:grid-cols-2">
              <ScopeList
                id="setup-connect-allows"
                label="What Google asks you to allow"
                icon={<CheckIcon />}
                items={[
                  "See your name and email address, so you know which login is connected",
                  "Manage your Business Profiles: reviews and replies, profile details, posts, photos and the listings themselves",
                ]}
              />
              <ScopeList
                id="setup-connect-never"
                label="What NabaPresence never does"
                icon={<XIcon />}
                items={[
                  "Send anything to Google unless someone on your team publishes, approves or schedules it",
                  "See or store your Google password",
                  "Read your Gmail",
                ]}
              />
            </div>
            <p className="text-caption text-ink-muted">
              You can disconnect the account at any time from Settings, under
              Google connections.
            </p>
          </div>

          <section
            aria-labelledby="setup-connected-logins"
            className="flex flex-col gap-2"
          >
            <h3
              id="setup-connected-logins"
              className="text-ui font-medium text-ink-muted"
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
              // Notion Mail's list rows. Each row carries its own buttons, so
              // the row itself is not a target (`interactive={false}`). On a
              // phone the list runs to the screen edge like the step around
              // it; in the md+ card the rows drop their own gutter so they
              // line up with the rest of the step.
              <ListRows bleed>
                {connections.map((connection) => {
                  const broken =
                    connection.reconnectRequired ||
                    connection.status !== "active"
                  return (
                    <ListRow
                      key={connection.id}
                      interactive={false}
                      emphasis="neutral"
                      className="md:px-0"
                      wrapperClassName="md:after:start-12 md:after:end-0 desk:after:start-11"
                      leading={
                        <Avatar size="list" aria-hidden>
                          G
                        </Avatar>
                      }
                      title={
                        // The whole address, wrapped: which login this is
                        // must never be cut off.
                        <span className="wrap-anywhere whitespace-normal">
                          {connection.googleEmail ?? "Google account"}
                        </span>
                      }
                      subtitle={
                        connection.lastRefreshAt ? (
                          <RelativeTime
                            iso={connection.lastRefreshAt}
                            prefix="Refreshed "
                          />
                        ) : (
                          "Not refreshed yet"
                        )
                      }
                      trailing={
                        broken ? (
                          <StatusPill tone="bad">Needs reconnecting</StatusPill>
                        ) : (
                          <StatusPill tone="ok">Connected</StatusPill>
                        )
                      }
                      tags={
                        broken ? (
                          <>
                            <span className="w-full text-caption text-ink-muted">
                              Reconnect it to use it here. Google opens, then
                              you come straight back to this step.
                            </span>
                            {/* Same reconnect as Settings' connection card:
                                target this login so Google pre-fills it and
                                the callback renews it rather than adding
                                one. */}
                            <Button
                              size="sm"
                              variant="secondary"
                              className="mt-1"
                              pending={
                                starting && startingFor === connection.id
                              }
                              pendingLabel="Opening Google…"
                              disabled={starting}
                              onClick={() => void connect(connection.id)}
                              aria-label={`Reconnect ${connection.googleEmail ?? "this Google account"}`}
                            >
                              Reconnect
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="mt-1"
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
                        )
                      }
                    />
                  )
                })}
              </ListRows>
            )}
            {usable.length > 0 ? (
              <p className="text-caption text-ink-muted">
                Choose “Use this account” to use a connected account for{" "}
                {business ? "your business" : clientName}, then pick its
                Business Profile accounts.
              </p>
            ) : null}
          </section>
        </div>
      )}
    </QueryStates>
  )
}

/** One half of the consent explanation: a plain label over short lines. */
function ScopeList({
  id,
  label,
  icon,
  items,
}: {
  id: string
  label: string
  icon: React.ReactNode
  items: string[]
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={id} className="text-ui font-medium text-ink-muted">
        {label}
      </p>
      <ul aria-labelledby={id} className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-ui text-ink">
            <span
              aria-hidden
              className="mt-0.5 shrink-0 text-ink-secondary [&_svg]:size-4"
            >
              {icon}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { StepConnect }
