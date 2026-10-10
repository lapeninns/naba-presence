"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import { approveLodging, confirmIndustry, fetchLodgingAttempt, previewLodging, publishIndustry } from "@/lib/api/location-industry"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import type { LodgingAttempt } from "@/lib/contracts/lodging-attempt"
import { queryKeys } from "@/lib/queries/keys"
import { useToastManager } from "@/components/ui/toast"

type Outcome = Pick<LodgingAttempt, "id" | "status" | "executionState" | "confirmationState"> & Partial<Pick<LodgingAttempt, "observedAt" | "targetResourceName">>
const preflightCodes = ["approval_required", "approval_stale", "approval_expired", "approval_policy_changed", "approval_actor_access_changed", "google_baseline_stale", "google_connection_changed", "google_target_changed", "permission_denied", "publish_not_allowed", "google_writes_paused", "google_reconnect_required"]

export function useLodgingReview(locationId: string, onLock?: (locked: boolean) => void) {
  const claim = useRef(false), unsafe = useRef(false)
  // The "unresolved" warning toast, so a later confirmed or rejected outcome
  // withdraws it instead of leaving it contradicting the panel.
  const unresolvedToast = useRef<string | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<GbpChangeSet | null>(null), [outcome, setOutcome] = useState<Outcome | null>(null)
  const [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectionRevision, setSelectionRevision] = useState(0)
  const client = useQueryClient(), toasts = useToastManager()
  const unresolved = uncertain || Boolean(outcome && outcome.confirmationState !== "confirmed" && outcome.executionState !== "rejected")
  async function run(work: () => Promise<void>) {
    if (claim.current) return
    claim.current = true; setBusy(true); setError(null); onLock?.(true)
    try { await work() }
    catch (failure) { setError(failure instanceof ApiClientError ? failure.message : "The response could not be read. Check the saved outcome before another action.") }
    finally {
      claim.current = false; setBusy(false); onLock?.(unsafe.current)
      setSelectionRevision((value) => value + 1)
      void client.invalidateQueries({ queryKey: queryKeys.locationActivity(locationId).slice(0, -1) })
      void client.invalidateQueries({ queryKey: [...queryKeys.locationIndustry(locationId), "workflows"] })
    }
  }
  function accept(result: Outcome) {
    setOutcome(result); setUncertain(false)
    unsafe.current = result.confirmationState !== "confirmed" && result.executionState !== "rejected"
    const warning = unresolvedToast.current
    if (warning && !unsafe.current) {
      unresolvedToast.current = null
      if (result.confirmationState === "confirmed") toasts.add({ id: warning, title: "Lodging details confirmed by Google", type: "success" })
      else toasts.close(warning)
    }
  }
  function preview(payload: Record<string, unknown>, updateMask: string[], googleHash: string) {
    if (unsafe.current) return
    void run(async () => { setReview(await previewLodging(locationId, { payload, updateMask, expectedGoogleHash: googleHash })); setOutcome(null); setStale(false); setOpen(true) })
  }
  function restore(change: GbpChangeSet) {
    if (claim.current || unsafe.current && review?.id !== change.id) return
    if (review?.id !== change.id) setStale(false)
    setReview(change); setOpen(true)
    void run(async () => {
      try { accept(await fetchLodgingAttempt(locationId, change.id)) }
      catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 404 && failure.code === "lodging_attempt_not_found") { unsafe.current = false; setUncertain(false); setOutcome(null); return }
        unsafe.current = true; setUncertain(true); throw failure
      }
    })
  }
  function approve() {
    if (review && !unsafe.current) void run(async () => { setReview(await approveLodging(locationId, review.id, review.payloadHash)) })
  }
  function send() {
    if (!review?.approvedBy || outcome || unsafe.current || stale) return
    void run(async () => {
      unsafe.current = true; setUncertain(true)
      try {
        const result = await publishIndustry(locationId, { operation: "update_lodging", payload: review.payload, updateMask: review.updateMask, changeSetId: review.id })
        accept({ ...result, executionState: result.executionState ?? "unknown", confirmationState: result.confirmationState ?? "unresolved" })
        if (result.confirmationState === "confirmed") toasts.add({ title: "Lodging details confirmed by Google", type: "success" })
        else if (result.executionState === "rejected") toasts.add({ title: "Google rejected the lodging changes. Check the saved outcome.", type: "error" })
        else unresolvedToast.current = toasts.add({ id: unresolvedToast.current ?? undefined, title: "Google confirmation is unresolved. Check the saved outcome before another change.", type: "warning" })
        void client.invalidateQueries({ queryKey: queryKeys.locationIndustry(locationId) })
      } catch (failure) {
        if (failure instanceof ApiClientError && preflightCodes.includes(failure.code)) { unsafe.current = false; setUncertain(false); setStale(true) }
        throw failure
      }
    })
  }
  function check(refresh = false) {
    if (!review) return
    void run(async () => {
      try {
        const saved = await fetchLodgingAttempt(locationId, review.id)
        accept(saved)
        if (refresh && saved.executionState !== "rejected") { await confirmIndustry(locationId, saved.id); accept(await fetchLodgingAttempt(locationId, review.id)) }
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 404 && failure.code === "lodging_attempt_not_found") { unsafe.current = false; setUncertain(false); setOutcome(null); return }
        throw failure
      }
    })
  }
  return { review, outcome, busy, error, open, uncertain, unresolved, stale, selectionRevision, preview, restore, approve, send, check, setOpen }
}
