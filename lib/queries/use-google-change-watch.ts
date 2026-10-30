"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { mintIntentId } from "@/lib/api/client"
import {
  approveBusinessInformation,
  publishBusinessInformation,
} from "@/lib/api/location-business-information"
import { businessInformationLocationUpdateSchema } from "@/lib/contracts/location-business-information"
import {
  checkGoogleChanges,
  decideGoogleChange,
  fetchGoogleChanges,
  fetchGoogleWatchSettings,
  saveGoogleWatchSettings,
} from "@/lib/api/google-change-watch"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import type {
  GoogleChangeDecisionInput,
  GoogleWatchSettingsInput,
} from "@/lib/contracts/google-change-watch"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** Rooted at the location, so a location-wide invalidation reaches them. */
export const googleChangeKeys = {
  changes: (id: string) => ["locations", id, "google-changes"] as const,
  settings: (id: string) => ["locations", id, "google-watch"] as const,
}

export function useGoogleChanges(id: string) {
  return useQuery({
    queryKey: googleChangeKeys.changes(id),
    queryFn: (ctx) => fetchGoogleChanges(id, requestOptions(ctx)),
  })
}

export function useGoogleWatchSettings(id: string) {
  return useQuery({
    queryKey: googleChangeKeys.settings(id),
    queryFn: (ctx) => fetchGoogleWatchSettings(id, requestOptions(ctx)),
  })
}

/**
 * What a check, decision, approval or publish can change: the watch itself,
 * the saved profile and hours, Google's suggestions on the same tab, the
 * business-information reviews, hours change requests, the summary and the
 * notifications the change opened or closed.
 */
function useInvalidateGoogleChanges(id: string) {
  const queryClient = useQueryClient()
  return () => {
    for (const queryKey of [
      googleChangeKeys.changes(id),
      queryKeys.locationProfile(id),
      queryKeys.locationHours(id),
      queryKeys.locationBusinessInformation(id),
      queryKeys.locationImportReview(id),
      queryKeys.importReviewCounts,
      queryKeys.listingChangeRequests(id),
      queryKeys.locationActivity(id),
      queryKeys.listingSummary(id),
      queryKeys.listingSummaries,
      queryKeys.notificationsAll,
      queryKeys.shellStatus,
    ]) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}

export function useCheckGoogleChanges(id: string) {
  const invalidate = useInvalidateGoogleChanges(id)
  return useMutation({
    mutationFn: () => checkGoogleChanges(id),
    onSuccess: invalidate,
  })
}

export function useDecideGoogleChange(id: string) {
  const invalidate = useInvalidateGoogleChanges(id)
  return useMutation({
    mutationFn: (input: GoogleChangeDecisionInput & { changeId: string }) =>
      decideGoogleChange(
        id,
        input.changeId,
        {
          action: input.action,
          expectedGoogleHash: input.expectedGoogleHash,
        },
        { intentId: mintIntentId() }
      ),
    onSettled: invalidate,
  })
}

/** The existing business-information approval, for a "Put ours back" change set. */
export function useApproveRestore(id: string) {
  const invalidate = useInvalidateGoogleChanges(id)
  return useMutation({
    mutationFn: (changeSet: GbpChangeSet) =>
      approveBusinessInformation(id, changeSet.id, changeSet.payloadHash),
    onSettled: invalidate,
  })
}

/** Google refused, failed or has not confirmed the write: not done yet. */
export class RestoreNotConfirmedError extends Error {
  constructor(readonly status: string) {
    super(
      status === "failed"
        ? "Google didn’t accept ours. Nothing changed on Google."
        : "Sent, but Google hasn’t confirmed it yet. Check again in a few minutes before sending it again."
    )
    this.name = "RestoreNotConfirmedError"
  }
}

/**
 * The existing business-information publish, bound to the reviewed
 * baseline, exactly as the saved-reviews list sends it: the body is
 * validated against the route's own schema, one intent per press, and only
 * a succeeded, confirmed attempt counts as sent.
 */
export function usePublishRestore(id: string) {
  const invalidate = useInvalidateGoogleChanges(id)
  return useMutation({
    mutationFn: async (changeSet: GbpChangeSet) => {
      const body = businessInformationLocationUpdateSchema.parse({
        operation: "update_location",
        confirmation: "publish_business_information_to_google",
        payload: changeSet.payload,
        updateMask: changeSet.updateMask,
        expectedGoogleHash: changeSet.baselineHash,
        changeSetId: changeSet.id,
      })
      const result = await publishBusinessInformation(id, body, {
        intentId: mintIntentId(),
      })
      if (
        result.status !== "succeeded" ||
        (result.confirmationState !== undefined &&
          result.confirmationState !== "confirmed")
      ) {
        throw new RestoreNotConfirmedError(result.status)
      }
      return result
    },
    onSettled: invalidate,
  })
}

export function useSaveGoogleWatchSettings(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GoogleWatchSettingsInput) =>
      saveGoogleWatchSettings(id, input),
    onSuccess: (data) => {
      queryClient.setQueryData(googleChangeKeys.settings(id), data)
      void queryClient.invalidateQueries({
        queryKey: googleChangeKeys.changes(id),
      })
    },
  })
}
