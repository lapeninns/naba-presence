"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"
import { useVerificationWorkspaceActions, type VerificationWorkflow } from "./verification-workspace-actions"

const messages: Readonly<Record<string, string>> = {
  verification_pin_changed: "The PIN differs from the reviewed PIN. Create a fresh preview and approval before submitting it.",
  approval_stale: "This review is no longer current. Refresh Google state and create a fresh review.",
  approval_expired: "This review has expired. Check current Google state and create a fresh review.",
  approval_policy_changed: "The approval policy changed. Create a fresh review under the current policy.",
  approval_actor_access_changed: "An initiating or approving manager's access changed. Create a fresh review with current authorised managers.",
  verification_option_changed: "Google's eligible destination or verification state changed. Check current methods and create a fresh review.",
  verification_state_changed: "Google verification changed after review. Refresh its current state before creating a fresh review.",
  google_target_changed: "The linked Google business changed. Refresh this listing before continuing.",
  verification_not_ready: "An interrupted request needs five minutes before an independent refresh. Check its saved status meanwhile.",
  publishing_paused: "Publishing to Google is paused. Saved outcomes can still be inspected.",
  verification_not_pending: "Google no longer reports this request as pending. Check its current state.",
}

/** Action closures keep transient inputs outside query and mutation caches. */
export function useVerificationAction(locationId: string, workflow: VerificationWorkflow) {
  const client = useQueryClient()
  const workspace = useVerificationWorkspaceActions()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return
    if (workspace && !workspace.claim()) return
    inFlight.current = true; setBusy(true); setError(null)
    try { await action() }
    catch (error) {
      if (!(error instanceof Error)) throw error
      setError(error instanceof ApiClientError ? messages[error.code] ?? (error.status === 404 ? "No saved outcome is available yet. Refresh the exact review before sending; reload saved requests after an interrupted send." : "This action could not finish. Check access, connection and the exact saved review or outcome before trying again.") : "The action response could not be read. Check the exact saved review or outcome before another action.")
    } finally { inFlight.current = false; setBusy(false); workspace?.release() }
  }
  function invalidate() {
    void client.invalidateQueries({ queryKey: ["verification-workflows", locationId] })
    void client.invalidateQueries({ queryKey: ["verification-state", locationId] })
    void client.invalidateQueries({ queryKey: queryKeys.locationAdministration(locationId) })
    void client.invalidateQueries({ queryKey: queryKeys.locationActivity(locationId).slice(0, -1) })
  }
  return { busy: busy || Boolean(workspace?.busy), active: !workspace || workspace.active === workflow,
    activate: () => workspace?.activate(workflow), error, run, invalidate, clearError: () => setError(null) }
}
