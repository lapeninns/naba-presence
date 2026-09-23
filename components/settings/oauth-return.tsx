"use client"

import { RefreshCw } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { cn } from "@/lib/utils"

function describeOAuthStatus(status: string | null): string {
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

type Outcome = { kind: "connected" } | { kind: "error"; message: string }

/**
 * What came back from Google's sign-in (`?google=connected|error&status=`):
 * a confirmation, or the cause in plain words with Try again. The query is
 * stripped once read, and the message stays until the page is left.
 */
export function OAuthReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const { connect } = useConnectionWorkspace()
  const google = params.get("google")
  const status = params.get("status")
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Same ref-guard shape as lib/locations/use-reset-on-revision.ts — only
  // handle a given `google`/`status` pair once, not on every incidental
  // re-render; and never reset when router.replace strips the query (the
  // identity changes, but the message stays).
  const identity = `${google ?? ""}:${status ?? ""}`
  const identityRef = useRef<string | null>(null)
  const next: Outcome | null =
    google === "connected"
      ? { kind: "connected" }
      : google === "error"
        ? { kind: "error", message: describeOAuthStatus(status) }
        : null
  useEffect(() => {
    if (google !== "connected" && google !== "error") return
    if (identityRef.current === identity) return
    identityRef.current = identity
    setOutcome(next)
    router.replace("/settings/connections")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, google, status])

  if (!outcome) return null
  if (outcome.kind === "connected") {
    return (
      <Alert variant="success">
        <AlertTitle>Google Business Profile connected</AlertTitle>
        <AlertDescription>
          Google confirmed access for this login. Link its locations to a
          client from client setup.
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
      <AlertTitle>We couldn’t connect Google</AlertTitle>
      <AlertDescription>
        {outcome.message} Nothing was changed.
      </AlertDescription>
      <AlertActions>
        <Button
          variant="secondary"
          size="sm"
          pending={connect.isPending}
          pendingLabel="Opening Google…"
          onClick={() => connect.mutate({})}
        >
          <RefreshCw aria-hidden />
          Try again
        </Button>
      </AlertActions>
    </Alert>
  )
}
