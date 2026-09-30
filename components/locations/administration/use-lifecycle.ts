"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import * as lifecycle from "@/lib/api/google-lifecycle"
import type { GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"
import type { LifecycleAttempt, LifecycleReview } from "@/lib/contracts/google-lifecycle-review"
import type { LifecycleWorkflow } from "@/lib/contracts/google-lifecycle-workflows"
import { queryKeys } from "@/lib/queries/keys"

const safePreflightCodes = new Set(["approval_required", "approval_stale", "approval_expired", "approval_policy_changed", "approval_actor_access_changed", "google_baseline_stale", "google_destination_changed", "google_connection_changed", "google_target_changed", "permission_denied", "publish_not_allowed", "google_writes_paused", "google_reconnect_required", "source_access_unknown", "source_membership_unproven", "deletion_eligibility_unproven", "source_ownership_required", "destination_matches_source", "destination_access_unproven", "destination_management_required", "destination_already_contains_location"])
const destinationCodes = new Set(["google_destination_changed", "destination_access_unproven", "destination_management_required", "destination_already_contains_location"])
/**
 * Why a saved review can no longer be sent: its approval expired, the
 * destination account's access changed, Google account access or membership
 * changed, or another preflight check needs a fresh review.
 */
export type LifecycleBlock = "expired" | "destination_changed" | "access_changed" | "fresh_review_required"
function blockFor(code: string): LifecycleBlock {
  if (code === "approval_expired") return "expired"
  if (destinationCodes.has(code)) return "destination_changed"
  if (code === "google_baseline_stale" || code === "google_connection_changed" || code === "approval_actor_access_changed") return "access_changed"
  return "fresh_review_required"
}
export function useLifecycle(locationId: string, accessBlocked = false) {
  const client = useQueryClient(), claim = useRef(false), unsafe = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<LifecycleReview | null>(null), [attempt, setAttempt] = useState<LifecycleAttempt | null>(null)
  const [uncertain, setUncertain] = useState(false), [block, setBlock] = useState<LifecycleBlock | null>(null), [blockedAt, setBlockedAt] = useState<string | null>(null), [revision, setRevision] = useState(0)
  const stale = block !== null
  const unresolved = uncertain || attempt?.confirmationState === "unresolved" || attempt?.confirmationState === "pending" || attempt?.localReconciliation === "pending" || attempt?.localReconciliation === "conflict"
  function invalidate() {
    void client.invalidateQueries({ queryKey: ["lifecycle-workflows", locationId] })
    void client.invalidateQueries({ queryKey: ["lifecycle-latest-attempt", locationId] })
    void client.invalidateQueries({ queryKey: queryKeys.locationAdministration(locationId) })
    void client.invalidateQueries({ queryKey: queryKeys.locationActivity(locationId).slice(0, -1) })
  }
  // A confirmed deletion or transfer changes the listing's state everywhere
  // it is summarised (the page header chip, the board and the directory).
  function invalidateListing() {
    void client.invalidateQueries({ queryKey: queryKeys.listingSummary(locationId) })
    void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
    void client.invalidateQueries({ queryKey: queryKeys.locations })
    void client.invalidateQueries({ queryKey: queryKeys.locationCapabilities(locationId) })
  }
  function receive(value: LifecycleAttempt) {
    unsafe.current = value.confirmationState === "pending" || value.confirmationState === "unresolved" || value.localReconciliation === "pending" || value.localReconciliation === "conflict"
    setAttempt(value); setUncertain(false)
    if (value.confirmationState === "confirmed") invalidateListing()
  }
  async function run<T>(work: () => Promise<T>) {
    if (claim.current) throw new ApiClientError(409, "administration_in_progress", "Wait for the current lifecycle action.")
    claim.current = true; setBusy(true); setError(null)
    try { return await work() }
    catch (error) {
      if (!(error instanceof Error)) throw error
      if (error instanceof ApiClientError && safePreflightCodes.has(error.code)) { setBlock(blockFor(error.code)); setBlockedAt(new Date().toISOString()) }
      setError(error instanceof ApiClientError ? error.message : "The response is unavailable. Read the saved lifecycle outcome before another write.")
      throw error
    } finally { claim.current = false; setBusy(false); invalidate() }
  }
  function handle(work: () => Promise<void>) { void run(work).catch((error: unknown) => { if (!(error instanceof Error)) throw error }) }
  function preview(request: GoogleLifecycleRequest) {
    return run(async () => {
      if (accessBlocked) throw new ApiClientError(409, "administration_in_progress", "Resolve the current access action before reviewing another write.")
      if (unsafe.current) throw new ApiClientError(409, "google_confirmation_unresolved", "Resolve the current lifecycle outcome before reviewing another write.")
      setReview(await lifecycle.previewLifecycle(locationId, request)); setAttempt(null); setUncertain(false); setBlock(null); setRevision((value) => value + 1)
    })
  }
  function open(item: LifecycleWorkflow) {
    handle(async () => {
      if (unsafe.current && (attempt?.reviewId ?? review?.changeSet.id) !== item.reviewId) throw new ApiClientError(409, "google_confirmation_unresolved", "Read the current unresolved outcome before opening another write.")
      if (item.attemptId) { receive(await lifecycle.fetchLifecycleAttempt(locationId, item.reviewId)); setReview(null) }
      else { setReview(await lifecycle.fetchLifecycleReview(locationId, item.reviewId)); setAttempt(null) }
      setBlock(null); setRevision((value) => value + 1)
    })
  }
  function approve() {
    if (review && !unsafe.current && !stale && !accessBlocked) handle(async () => { setReview(await lifecycle.approveLifecycle(locationId, review.changeSet.id, review.changeSet.payloadHash)); setRevision((value) => value + 1) })
  }
  function execute() {
    if (review?.changeSet.approvedBy && !unsafe.current && !stale && !accessBlocked) handle(async () => {
      unsafe.current = true; setUncertain(true)
      try { receive(await lifecycle.executeLifecycle(locationId, review.changeSet.id, review.changeSet.payloadHash)) }
      catch (error) {
        if (error instanceof ApiClientError && safePreflightCodes.has(error.code)) { unsafe.current = false; setUncertain(false) }
        throw error
      } finally { setRevision((value) => value + 1) }
    })
  }
  function check(refresh = false) {
    const reviewId = attempt?.reviewId ?? review?.changeSet.id
    if (reviewId) handle(async () => {
      try { receive(await (refresh ? lifecycle.refreshLifecycleAttempt : lifecycle.fetchLifecycleAttempt)(locationId, reviewId)) }
      catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 404 || error.code !== "lifecycle_attempt_not_found") throw error
        const restored = await lifecycle.fetchLifecycleReview(locationId, reviewId)
        unsafe.current = false; setUncertain(false); setReview(restored); setAttempt(null)
      } finally { setRevision((value) => value + 1) }
    })
  }
  /** Save a fresh review of the same request, replacing a blocked one. */
  function refreshReview() {
    const request = review?.request
    if (request) void preview(request).catch((error: unknown) => { if (!(error instanceof Error)) throw error })
  }
  function reset() { if (!claim.current && !unsafe.current) { setReview(null); setAttempt(null); setError(null); setBlock(null); setRevision((value) => value + 1) } }
  return { busy, error, review, attempt, uncertain, stale, block, blockedAt, unresolved, revision, preview, refreshReview, open, approve, execute, check, reset }
}
