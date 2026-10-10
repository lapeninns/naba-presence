"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import { approveBusinessInformation, confirmBusinessInformation, fetchServiceAttempt, previewBusinessInformation, publishBusinessInformation } from "@/lib/api/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import type { ServiceAttempt } from "@/lib/contracts/service-attempt"
import { googleServiceItemsSchema, type GoogleServiceItem } from "@/lib/domain/google-services"
import { queryKeys } from "@/lib/queries/keys"

const preflightCodes = ["approval_required", "approval_stale", "approval_expired", "approval_policy_changed", "approval_actor_access_changed", "google_baseline_stale", "business_information_stale", "google_connection_changed", "google_target_changed", "permission_denied", "publish_not_allowed", "business_information_paused", "google_reconnect_required", "location_ineligible", "eligibility_unknown", "service_baseline_unsupported", "service_categories_unknown", "service_metadata_incomplete", "service_not_supported"]

export function useServiceReview(locationId: string, onConfirmed: (review: GbpChangeSet) => void) {
  const claim = useRef(false), unsafe = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<GbpChangeSet | null>(null), [outcome, setOutcome] = useState<ServiceAttempt | null>(null)
  const [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false)
  const [open, setOpen] = useState(false), [selectionRevision, setSelectionRevision] = useState(0)
  const client = useQueryClient()
  const unresolved = uncertain || Boolean(outcome && outcome.confirmationState !== "confirmed" && outcome.executionState !== "rejected")
  async function run(work: () => Promise<void>) {
    if (claim.current) return
    claim.current = true; setBusy(true); setError(null)
    try { await work() }
    catch (failure) { setError(failure instanceof ApiClientError ? failure.message : "The response could not be read. Check the saved outcome before another action.") }
    finally {
      claim.current = false; setBusy(false); setSelectionRevision((value) => value + 1)
      void client.invalidateQueries({ queryKey: queryKeys.locationActivity(locationId).slice(0, -1) })
      void client.invalidateQueries({ queryKey: [...queryKeys.locationBusinessInformation(locationId), "reviews"] })
      void client.invalidateQueries({ queryKey: [...queryKeys.locationBusinessInformation(locationId), "service-workflows"] })
    }
  }
  function accept(saved: ServiceAttempt, change: GbpChangeSet) {
    setOutcome(saved); setUncertain(false)
    unsafe.current = saved.confirmationState !== "confirmed" && saved.executionState !== "rejected"
    if (saved.confirmationState === "confirmed") {
      onConfirmed(change)
      void client.invalidateQueries({ queryKey: queryKeys.locationBusinessInformation(locationId) })
    }
  }
  function preview(items: GoogleServiceItem[], googleHash: string) {
    if (unsafe.current) return
    void run(async () => { setReview(await previewBusinessInformation(locationId, { payload: { serviceItems: items }, updateMask: ["serviceItems"], expectedGoogleHash: googleHash })); setOutcome(null); setStale(false); setOpen(true) })
  }
  function restore(change: GbpChangeSet) {
    if (claim.current || unsafe.current && review?.id !== change.id) return
    const previouslyUnsafe = unsafe.current
    setReview(change); setOpen(true); setStale(false)
    void run(async () => {
      try { accept(await fetchServiceAttempt(locationId, change.id), change) }
      catch (failure) {
        if (!previouslyUnsafe && failure instanceof ApiClientError && failure.status === 404 && failure.code === "service_attempt_not_found") { setOutcome(null); setUncertain(false); return }
        unsafe.current = true; setUncertain(true); throw failure
      }
    })
  }
  function approve() {
    if (review && !unsafe.current) void run(async () => { setReview(await approveBusinessInformation(locationId, review.id, review.payloadHash)) })
  }
  function send() {
    if (!review?.approvedBy || outcome || unsafe.current || stale) return
    void run(async () => {
      const items = googleServiceItemsSchema.parse(review.payload.serviceItems)
      unsafe.current = true; setUncertain(true)
      try {
        await publishBusinessInformation(locationId, { payload: { serviceItems: items }, updateMask: ["serviceItems"], expectedGoogleHash: review.baselineHash, changeSetId: review.id })
        accept(await fetchServiceAttempt(locationId, review.id), review)
      } catch (failure) {
        if (failure instanceof ApiClientError && preflightCodes.includes(failure.code)) { unsafe.current = false; setUncertain(false); setStale(true) }
        throw failure
      }
    })
  }
  function check(refresh = false) {
    if (!review) return
    void run(async () => {
      const saved = await fetchServiceAttempt(locationId, review.id)
      accept(saved, review)
      if (refresh && saved.executionState !== "rejected") { await confirmBusinessInformation(locationId, saved.id); accept(await fetchServiceAttempt(locationId, review.id), review) }
    })
  }
  return { review, outcome, busy, error, open, uncertain, unresolved, stale, selectionRevision, preview, restore, approve, send, check, setOpen }
}
