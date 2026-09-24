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
import { Button, buttonVariants } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import type { ConnectStartBody } from "@/lib/contracts/connections"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { cn } from "@/lib/utils"

/** The parameters the OAuth callback appends; everything else is the page's. */
const OAUTH_PARAMS = [
  "google",
  "status",
  "rid",
  "reason",
  "reconnected",
  "mismatch",
  "catchup",
]

/** Where a successful connection gets its own confirmation panel. */
const CONNECTIONS_PATH = "/settings/connections"

function describeOAuthStatus(
  status: string | null,
  reason: string | null
): string {
  if (reason === "google_scope_missing") {
    return "Google didn’t give NabaPresence permission to manage your Business Profiles, so nothing was connected. Connect again and leave the Business Profile permission ticked on Google’s consent screen."
  }
  if (reason === "google_offline_access_missing") {
    return "Google didn’t grant lasting access, so the connection would have stopped within the hour. Nothing was connected. Try again."
  }
  switch (status) {
    case "400":
      return "Google sign-in was cancelled or couldn’t be completed. Try connecting again."
    case "401":
      return "Your session expired during sign-in. Sign in again, then reconnect."
    case "403":
      return "You don’t have permission to connect Google for this organisation."
    case "429":
      return "Google is rate-limiting requests right now. Try again shortly."
    default:
      return "Google is temporarily unavailable. Try connecting again shortly."
  }
}

type Outcome =
  | { kind: "connected"; reconnected: boolean; mismatch: boolean; catchUp: number }
  | { kind: "error"; title: string; message: string }

/**
 * What a successful connect or reconnect says. Only facts the callback
 * reported: how many listings are catching up, never a review count nobody
 * has fetched yet.
 */
export function connectedMessage(outcome: {
  reconnected: boolean
  mismatch: boolean
  catchUp: number
}): { title: string; description: string } {
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
  const toast = useToastManager()
  const { connect } = useConnectionWorkspace()
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
        }
      : google === "error"
        ? {
            kind: "error",
            title:
              reason === "google_scope_missing"
                ? "Permission not granted"
                : "We couldn’t connect Google",
            message: describeOAuthStatus(status, reason),
          }
        : null
  useEffect(() => {
    if (google !== "connected" && google !== "error") return
    if (identityRef.current === identity) return
    identityRef.current = identity
    // The connections page confirms with its own panel; anywhere else a
    // toast, so the page's own content stays in charge -- except a
    // different-account result, which needs to stay on screen.
    const panel =
      next?.kind === "connected" && !onConnectionsPage && !next.mismatch
        ? null
        : next
    setOutcome(panel)
    if (next?.kind === "connected" && !panel) {
      const message = connectedMessage(next)
      toast.add({
        title: message.title,
        description: message.description,
        type: "success",
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
    return (
      <Alert variant={outcome.mismatch ? "warning" : "success"}>
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>
          {message.description}
          {outcome.reconnected || outcome.mismatch
            ? ""
            : " Link its locations to a client from client setup."}
        </AlertDescription>
        <AlertActions>
          <Link
            href="/clients/new"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            Set up a client with it
          </Link>
        </AlertActions>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>{outcome.title}</AlertTitle>
      <AlertDescription>
        {outcome.message} Nothing was changed.
      </AlertDescription>
      <AlertActions>
        <Button
          variant="secondary"
          size="sm"
          pending={connect.isPending}
          pendingLabel="Opening Google…"
          onClick={() => connect.mutate(connectInput)}
        >
          <RefreshCw aria-hidden />
          Try again
        </Button>
      </AlertActions>
    </Alert>
  )
}
