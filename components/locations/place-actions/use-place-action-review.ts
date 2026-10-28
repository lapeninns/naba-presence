"use client"
import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
import {
  approvePlaceActionReview,
  previewPlaceActionReview,
  readPlaceActionOutcome,
  refreshPlaceActionOutcome,
  sendPlaceActionReview,
} from "@/lib/api/place-action-reviews"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import {
  placeActionReviewSchema,
  reviewedPlaceActionPayloadSchema,
  type PlaceActionAttempt,
  type PlaceActionReview,
  type ReviewedPlaceActionRequest,
} from "@/lib/contracts/place-action-review"
import { queryKeys } from "@/lib/queries/keys"

/**
 * The server's refusals in booking link words, with the next step: its own
 * messages say "action link" and are shared with bulk work and logs. Only
 * the words shown here change; codes, statuses and the `preflight` logic
 * below are the server's. An unknown code keeps the server's message.
 */
const BOOKING_LINK_MESSAGE: Record<string, string> = {
  place_action_target_missing:
    "Google no longer lists this booking link. Check Google now, then try again.",
  place_action_already_present: "Google already lists this booking link.",
  place_action_no_change: "Google already shows this link with these settings.",
  place_action_not_supported:
    "Google no longer offers this kind of booking link for this listing. Check Google now, or manage it in Google.",
  place_action_not_editable:
    "This booking link can’t be changed here. Manage it in Google.",
  place_actions_paused:
    "Booking link changes are paused for now. Nothing was sent to Google.",
  google_baseline_stale:
    "Google’s booking links changed after this review. Check Google now and review again.",
  google_target_changed:
    "The linked Google account or listing changed since this review. Reconnect the same one, or prepare a fresh review.",
  google_reconnect_required:
    "Reconnect the linked Google account, then try again.",
  publish_not_allowed:
    "Only an owner or administrator who can publish this listing can change its booking links.",
  place_action_review_unreadable:
    "This saved booking link review can’t be restored safely. Prepare a fresh one.",
  place_action_attempt_unreadable:
    "This booking link outcome needs a check by support before another change.",
  place_action_not_ready:
    "This interrupted send can be checked five minutes after it started.",
  place_action_observation_unreadable:
    "Google returned booking links we can’t read safely. Check Google now, or manage them in Google.",
  google_confirmation_unresolved:
    "An earlier change on this Google account is still waiting for its outcome. Open its saved outcome before another booking link change.",
}
export function bookingLinkMessage(failure: ApiClientError): string {
  // One code, two meanings: nothing recorded yet (404), or a send whose record went missing (409).
  if (failure.code === "place_action_attempt_not_found")
    return failure.status === 404
      ? "No send is recorded for this booking link review yet."
      : "This booking link change needs a check by support before another change."
  return BOOKING_LINK_MESSAGE[failure.code] ?? failure.message
}

const preflight = [
  "approval_required",
  "approval_stale",
  "approval_expired",
  "approval_policy_changed",
  "approval_actor_access_changed",
  "google_baseline_stale",
  "google_connection_changed",
  "google_target_changed",
  "publish_not_allowed",
  "place_actions_paused",
  "google_writes_paused",
  "google_reconnect_required",
  "place_action_not_supported",
  "place_action_not_editable",
  "place_action_target_missing",
  "place_action_no_change",
  "place_action_already_present",
  "google_confirmation_unresolved",
  "administration_in_progress",
]
export function usePlaceActionReview(locationId: string) {
  const claim = useRef(false),
    unsafe = useRef(false),
    client = useQueryClient()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<PlaceActionReview | null>(null),
    [outcome, setOutcome] = useState<PlaceActionAttempt | null>(null)
  const [open, setOpen] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [stale, setStale] = useState(false),
    [revision, setRevision] = useState(0)
  const unresolved =
    uncertain ||
    Boolean(
      outcome &&
      outcome.executionState !== "rejected" &&
      outcome.confirmationState !== "confirmed"
    )
  // `shared: false` returns a failure to the surface that started the work instead of the shared alert.
  async function run(
    work: () => Promise<void>,
    shared = true
  ): Promise<{ ok: boolean; error: string | null }> {
    if (claim.current) return { ok: false, error: null }
    claim.current = true
    setBusy(true)
    setError(null)
    try {
      await work()
      return { ok: true, error: null }
    } catch (failure) {
      const message =
        failure instanceof ApiClientError
          ? bookingLinkMessage(failure)
          : "The response couldn’t be read. Read the saved outcome before another change."
      if (shared) setError(message)
      return { ok: false, error: message }
    } finally {
      claim.current = false
      setBusy(false)
      setRevision((value) => value + 1)
      void client.invalidateQueries({
        queryKey: [...queryKeys.locationBooking(locationId), "workflows"],
      })
      void client.invalidateQueries({
        queryKey: queryKeys.locationActivity(locationId),
      })
    }
  }
  function accept(saved: PlaceActionAttempt) {
    setOutcome(saved)
    setUncertain(false)
    unsafe.current =
      saved.executionState !== "rejected" &&
      saved.confirmationState !== "confirmed"
    if (saved.confirmationState === "confirmed")
      void client.invalidateQueries({
        queryKey: queryKeys.locationBooking(locationId),
      })
  }
  function preview(request: ReviewedPlaceActionRequest) {
    if (unsafe.current)
      return Promise.resolve({
        ok: false,
        error: "Read the saved booking link outcome before another change.",
      })
    return run(async () => {
      setReview(await previewPlaceActionReview(locationId, request))
      setOutcome(null)
      setStale(false)
      setOpen(true)
    }, false)
  }
  function restore(changeSet: GbpChangeSet) {
    if (
      claim.current ||
      (unsafe.current && review?.changeSet.id !== changeSet.id)
    )
      return
    const wasUnsafe = unsafe.current
    void run(async () => {
      const payload = reviewedPlaceActionPayloadSchema.parse(changeSet.payload)
      setReview(
        placeActionReviewSchema.parse({
          changeSet,
          request: payload.request,
          target: changeSet.targetResourceName,
          observedAt: payload.observedAt,
        })
      )
      setOpen(true)
      setStale(false)
      try {
        accept(await readPlaceActionOutcome(locationId, changeSet.id))
      } catch (failure) {
        if (
          !wasUnsafe &&
          failure instanceof ApiClientError &&
          failure.status === 404 &&
          failure.code === "place_action_attempt_not_found"
        ) {
          setOutcome(null)
          setUncertain(false)
          return
        }
        unsafe.current = true
        setUncertain(true)
        throw failure
      }
    })
  }
  function approve() {
    if (review && !unsafe.current)
      void run(async () => {
        setReview(
          await approvePlaceActionReview(
            locationId,
            review.changeSet.id,
            review.changeSet.payloadHash
          )
        )
      })
  }
  function send() {
    if (!review?.changeSet.approvedBy || outcome || unsafe.current || stale)
      return
    void run(async () => {
      unsafe.current = true
      setUncertain(true)
      try {
        accept(
          await sendPlaceActionReview(
            locationId,
            review.changeSet.id,
            review.changeSet.payloadHash
          )
        )
      } catch (failure) {
        if (
          failure instanceof ApiClientError &&
          preflight.includes(failure.code)
        ) {
          unsafe.current = false
          setUncertain(false)
          setStale(true)
        }
        throw failure
      }
    })
  }
  function check(refresh = false) {
    if (review)
      void run(async () => {
        const saved = await readPlaceActionOutcome(
          locationId,
          review.changeSet.id
        )
        accept(saved)
        if (
          refresh &&
          saved.executionState !== "rejected" &&
          saved.confirmationState !== "confirmed"
        )
          accept(
            await refreshPlaceActionOutcome(locationId, review.changeSet.id)
          )
      })
  }
  return {
    review,
    outcome,
    open,
    uncertain,
    unresolved,
    stale,
    revision,
    busy,
    error,
    setOpen,
    preview,
    restore,
    approve,
    send,
    check,
  }
}
