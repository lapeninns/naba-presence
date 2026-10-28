"use client"

import { RefreshCw } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { SupportDetails } from "@/components/editors/support-details"
import { Button, buttonVariants } from "@/components/ui/button"
import { useOutcomeToast } from "@/components/ui/toast"
import type { ConnectStartBody } from "@/lib/contracts/connections"
import { describeActionError } from "@/lib/errors/action-errors"
import { useStartGoogleConnect } from "@/lib/queries/use-connection-workspace"
import { describeGoogleConnectStatus } from "@/lib/setup/oauth-status"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/** The parameters the OAuth callback appends; everything else is the page's. */
const OAUTH_PARAMS = [
  "google",
  "status",
  "rid",
  "reason",
  "reconnected",
  "mismatch",
  "catchup",
  "limit",
]

/** Where a successful connection gets its own confirmation panel. */
const CONNECTIONS_PATH = "/settings/connections"

/**
 * The callback's failure in plain words. One source with setup's connect
 * step (`describeGoogleConnectStatus`), so Settings and setup never say
 * different things about the same failure; only the lost-offline-access
 * case, which setup doesn't name, is worded here. The 401, 403 and 429
 * wordings don't say nothing happened, which Settings always has: the
 * callback fails those before any connection is written.
 */
function describeOAuthStatus(
  status: string | null,
  reason: string | null,
  mode: "business" | "agency"
): string {
  if (reason === "google_offline_access_missing") {
    return "Google didn’t grant lasting access, so the connection would have stopped within the hour. Nothing was connected. Try again."
  }
  const message = describeGoogleConnectStatus(status, reason, mode)
  return reason !== "google_scope_missing" &&
    (status === "401" || status === "403" || status === "429")
    ? `${message} Nothing was changed.`
    : message
}

type Outcome =
  | {
      kind: "connected"
      reconnected: boolean
      mismatch: boolean
      catchUp: number
      locationLimit?: boolean
    }
  | {
      kind: "error"
      title: string
      message: string
      /** The callback's `rid`, for quoting to support. */
      requestId: string | null
    }

/**
 * What a successful connect or reconnect says. Only facts the callback
 * reported: how many listings are catching up, never a review count nobody
 * has fetched yet.
 */
export function connectedMessage(outcome: {
  reconnected: boolean
  mismatch: boolean
  catchUp: number
  /** Linking its location would have passed the plan's location limit. */
  locationLimit?: boolean
}): { title: string; description: string } {
  if (outcome.locationLimit) {
    return {
      title: "Connected, but no location was linked",
      description:
        "This workspace has reached its plan’s location limit. Unlink a location or change plan, then link this one.",
    }
  }
  if (outcome.mismatch) {
    return {
      title: "Connected a different Google account",
      description:
        "That login was added as its own connection. The one you were reconnecting still needs its own login, or can be disconnected.",
    }
  }
  if (outcome.reconnected) {
    return {
      title: "Reconnected",
      description:
        outcome.catchUp > 0
          ? `Checking Google now for anything missed on ${outcome.catchUp === 1 ? "1 listing" : `${outcome.catchUp} listings`}. New reviews appear as they arrive.`
          : "Google accepted the login again.",
    }
  }
  return {
    title: "Google Business Profile connected",
    description: "Google confirmed access for this login.",
  }
}

/**
 * The outcome of a Google OAuth round trip (`?google=connected|error&status=
 * &reason=`), on whichever page the flow returned to: the callback sends
 * failures back to where they started, such as a setup step, rather than
 * always to Settings. `connectInput` is what "Try again" restarts with, so a
 * retry from setup stays in setup. Only the callback's own parameters are
 * stripped, and the message stays until the page is left.
 */
export function OAuthReturn({
  connectInput = {},
}: { connectInput?: ConnectStartBody } = {}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const toast = useOutcomeToast()
  // Only the connect mutation, never the connections query: this mounts on
  // every dashboard page through the shell, and subscribing to (and
  // building) the polled connections query while rendering here is what
  // named OAuthReturn in the dashboard-wide "Cannot update QueryProvider
  // while rendering" warning (settings-setup-auth-21). Same request, same
  // body, and the same toast on a failed handshake as the workspace's
  // `connect`.
  const connect = useStartGoogleConnect()
  const business = useWorkspaceMode() === "business"
  const google = params.get("google")
  const status = params.get("status")
  const reason = params.get("reason")
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Same ref-guard shape as lib/locations/use-reset-on-revision.ts — only
  // handle a given callback result once, not on every incidental re-render;
  // and never reset when router.replace strips the query (the identity
  // changes, but the message stays).
  const identity = `${google ?? ""}:${status ?? ""}:${reason ?? ""}`
  const identityRef = useRef<string | null>(null)
  const onConnectionsPage = pathname === CONNECTIONS_PATH
  const next: Outcome | null =
    google === "connected"
      ? {
          kind: "connected",
          reconnected: params.get("reconnected") === "1",
          mismatch: params.get("mismatch") === "1",
          catchUp: Number.parseInt(params.get("catchup") ?? "0", 10) || 0,
          locationLimit: params.get("limit") === "1",
        }
      : google === "error"
        ? {
            kind: "error",
            title:
              reason === "google_scope_missing"
                ? "Permission not granted"
                : "We couldn’t connect Google",
            message: describeOAuthStatus(
              status,
              reason,
              business ? "business" : "agency"
            ),
            // Read before the strip below; the panel keeps it afterwards.
            requestId: params.get("rid"),
          }
        : null
  useEffect(() => {
    if (google !== "connected" && google !== "error") return
    if (identityRef.current === identity) return
    identityRef.current = identity
    // The connections page confirms with its own panel; anywhere else a
    // toast, so the page's own content stays in charge -- except a
    // different-account or location-limit result, which needs to stay on
    // screen.
    const panel =
      next?.kind === "connected" &&
      !onConnectionsPage &&
      !next.mismatch &&
      !next.locationLimit
        ? null
        : next
    setOutcome(panel)
    if (next?.kind === "connected" && !panel) {
      const message = connectedMessage(next)
      // Google granted access: an outcome, never Undo (D5).
      toast.show({
        kind: "google",
        title: message.title,
        description: message.description,
      })
    }
    const remaining = new URLSearchParams(params.toString())
    for (const key of OAUTH_PARAMS) remaining.delete(key)
    const query = remaining.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, google, status])

  if (!outcome) return null
  if (outcome.kind === "connected") {
    const message = connectedMessage(outcome)
    // A reconnect or a plan-limit result already has its own next step in
    // the copy; only a plain new connection gets the setup sentence.
    const plain =
      !outcome.reconnected && !outcome.mismatch && !outcome.locationLimit
    // A different login came back active and usable (the callback upserts
    // it as its own connection), so it can be set up like a new one.
    const nextStep = plain || (outcome.mismatch && !outcome.locationLimit)
    return (
      <Alert
        variant={
          outcome.mismatch || outcome.locationLimit ? "warning" : "success"
        }
      >
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>
          {message.description}
          {plain
            ? business
              ? // The callback may already have linked a lone listing, so
                // this must read true either way.
                " Setup shows which of its listings are linked, and lets you link the rest."
              : " Link its locations to a client from client setup."
            : ""}
        </AlertDescription>
        {nextStep ? (
          <AlertActions>
            <Link
              href={business ? "/setup" : "/clients/new"}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              {business ? "Add locations with it" : "Set up a client with it"}
            </Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>{outcome.title}</AlertTitle>
      <AlertDescription>
        <p>{outcome.message}</p>
        <SupportDetails items={[outcome.requestId]} />
      </AlertDescription>
      <AlertActions>
        <Button
          variant="secondary"
          size="sm"
          pending={connect.isPending}
          pendingLabel="Opening Google…"
          onClick={() =>
            connect.mutate(connectInput, {
              onError: (error) =>
                toast.show({
                  title: describeActionError(error),
                  type: "error",
                }),
            })
          }
        >
          <RefreshCw aria-hidden />
          Try again
        </Button>
      </AlertActions>
    </Alert>
  )
}
