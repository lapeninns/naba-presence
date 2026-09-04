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
  // inside an effect. Same ref-guard shape as lib/locations/use-reset-on-revision.ts
  // — only handle a given `google`/`status` pair once, not on every incidental
  // re-render. `useResetOnRevision` itself does not fit here: this effect must
  // fire on mount for a fresh `?google=` pair, and must NOT reset `error` when
  // router.replace strips the query (identity changes, but the alert stays).
  const identity = `${google ?? ""}:${status ?? ""}`
  const identityRef = useRef<string | null>(null)
  const errorMessage = google === "error" ? describeOAuthStatus(status) : null
  useEffect(() => {
    // Nothing to process on the settled pass (router.replace below strips the
    // ?google= query, which re-renders with google === null) or for any other
    // unrecognised value — no-op, so a previously-shown error stays visible
    // until unmount / Try again.
    if (google !== "connected" && google !== "error") return
    if (identityRef.current === identity) return
    identityRef.current = identity
    // Single unconditional setState call, directly gated by the ref-guard
    // above (react-hooks/set-state-in-effect only recognises a setState call
    // as ref-guarded when it's the immediate, unconditional statement after
    // the ref check — the same shape as lib/locations/use-reset-on-revision.ts —
    // so the connected/error split is expressed as a value, not a nested `if`
    // wrapping the call).
    setError(google === "error" ? errorMessage : null)
    if (google === "connected") {
      toast.add({ title: "Google Business Profile connected", type: "success" })
    }
    router.replace("/settings/connections")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, google, status, errorMessage])

  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn’t connect Google</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" disabled={connect.isPending} onClick={() => connect.mutate({})}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}
