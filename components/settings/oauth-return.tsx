"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

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

export function OAuthReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const toast = useToastManager()
  const { connect } = useConnectionWorkspace()
  const google = params.get("google")
  const status = params.get("status")
  const [error, setError] = useState<string | null>(null)

  // Deviation from the brief's reference impl (a bare `setState` in the effect
  // body): react-hooks/set-state-in-effect flags a synchronous setState call
  // inside an effect. Mirrors the ref-guard convention already used by
  // components/locations/hours-tab.tsx (see task-5-report.md) — only handle a
  // given `google`/`status` pair once, not on every incidental re-render.
  const identity = `${google ?? ""}:${status ?? ""}`
  const identityRef = useRef<string | null>(null)
  const errorMessage = google === "error" ? describeOAuthStatus(status) : null
  useEffect(() => {
    if (identityRef.current === identity) return
    identityRef.current = identity
    setError(errorMessage)
    if (google === "connected") {
      toast.add({ title: "Google Business Profile connected", type: "success" })
      router.replace("/settings/connections")
    } else if (google === "error") {
      // Keep the message; strip the query so a refresh doesn’t re-toast/re-error.
      router.replace("/settings/connections")
    }
    // Only react to the raw query values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, google, status, errorMessage])

  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn’t connect Google</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}
