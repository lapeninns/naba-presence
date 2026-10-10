"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import * as access from "@/lib/api/google-administration-access"
import type { AdministrationAccessRequest, AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import type { AdministrationAccessAttempt } from "@/lib/contracts/google-administration-attempt"
import type { AdministrationWorkflow } from "@/lib/contracts/google-administration-workflows"
import { queryKeys } from "@/lib/queries/keys"

export function useAdministrationAccessController(locationId: string) {
  const client = useQueryClient(), claim = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<AdministrationAccessReview | null>(null)
  const [attempt, setAttempt] = useState<AdministrationAccessAttempt | null>(null)
  const [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false)
  const [selectionRevision, setSelectionRevision] = useState(0)
  // When this session last received an independently confirmed outcome; the
  // roster read before that moment no longer describes Google.
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null)
  const unresolved = uncertain || attempt?.confirmationState === "unresolved" || attempt?.confirmationState === "pending"
  function invalidate() {
    void client.invalidateQueries({ queryKey: ["administration-access-workflows", locationId] })
    void client.invalidateQueries({ queryKey: queryKeys.locationAdministration(locationId) })
    void client.invalidateQueries({ queryKey: queryKeys.locationActivity(locationId).slice(0, -1) })
  }
  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (claim.current) throw new ApiClientError(409, "administration_in_progress", "Wait for the current administration action.")
    claim.current = true; setBusy(true); setError(null)
    try { return await work() }
    catch (error) {
      if (!(error instanceof Error)) throw error
      const code = error instanceof ApiClientError ? error.code : "unreadable_response"
      if (["approval_stale", "approval_expired", "approval_policy_changed", "approval_actor_access_changed", "google_baseline_stale", "google_connection_changed", "google_target_changed", "administration_target_changed"].includes(code)) setStale(true)
      setError(error instanceof ApiClientError ? error.message : "The response could not be read. Check the saved outcome before another action.")
      throw error
    } finally { claim.current = false; setBusy(false); invalidate() }
  }
  function receive(value: AdministrationAccessAttempt) {
    setAttempt(value)
    if (value.confirmationState === "confirmed") setConfirmedAt(Date.now())
  }
  function handle(work: () => Promise<void>) { void run(work).catch((error: unknown) => { if (!(error instanceof Error)) throw error }) }
  async function preview(request: AdministrationAccessRequest) {
    if (unresolved) throw new ApiClientError(409, "google_confirmation_unresolved", "Check the unresolved saved outcome before reviewing another write.")
    return run(async () => {
      const saved = await access.previewAdministrationAccess(locationId, request)
      setReview(saved); setAttempt(null); setUncertain(false); setStale(false)
      setSelectionRevision((value) => value + 1)
      return saved
    })
  }
  function open(item: AdministrationWorkflow) {
    handle(async () => {
      if (unresolved && (review?.changeSet.id ?? attempt?.reviewId) !== item.reviewId) throw new ApiClientError(409, "google_confirmation_unresolved", "Check the current unresolved outcome before opening another write.")
      if (item.attemptId) { receive(await access.fetchAdministrationAccessAttempt(locationId, item.reviewId)); setReview(null) }
      else { setReview(await access.fetchAdministrationAccessReview(locationId, item.reviewId)); setAttempt(null) }
      setUncertain(false); setStale(false)
      setSelectionRevision((value) => value + 1)
    })
  }
  function approve() {
    if (review) handle(async () => { setReview(await access.approveAdministrationAccess(locationId, review.changeSet.id, review.changeSet.payloadHash)) })
  }
  function execute() {
    if (review && !unresolved && !stale) handle(async () => {
      setUncertain(true)
      try {
        receive(await access.executeAdministrationAccess(locationId, review.changeSet.id, review.changeSet.payloadHash))
        setUncertain(false)
      } catch (error) {
        if (error instanceof ApiClientError && ["approval_required", "approval_stale", "approval_expired", "approval_policy_changed", "approval_actor_access_changed", "google_baseline_stale", "google_connection_changed", "google_target_changed", "administration_target_changed", "permission_denied", "publish_not_allowed", "google_writes_paused", "google_reconnect_required"].includes(error.code)) setUncertain(false)
        throw error
      } finally { setSelectionRevision((value) => value + 1) }
    })
  }
  function check(refresh = false) {
    const reviewId = attempt?.reviewId ?? review?.changeSet.id
    if (reviewId) handle(async () => {
      try {
        receive(await (refresh ? access.refreshAdministrationAccessAttempt : access.fetchAdministrationAccessAttempt)(locationId, reviewId))
        setUncertain(false)
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 404 || error.code !== "administration_attempt_not_found") throw error
        setUncertain(false); setSelectionRevision((value) => value + 1)
        setReview(await access.fetchAdministrationAccessReview(locationId, reviewId))
      }
    })
  }
  function reset() { if (!busy && !unresolved) { setReview(null); setAttempt(null); setError(null); setStale(false) } }
  return { busy, error, review, attempt, uncertain, stale, unresolved, selectionRevision, confirmedAt, preview, open, approve, execute, check, reset }
}
