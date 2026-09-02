import {
  placeActionMutationOutcomeSchema,
  placeActionsResponseSchema,
  type PlaceActionDeleteRequest,
  type PlaceActionInput,
  type PlaceActionLink,
  type PlaceActionMutationOutcome,
  type PlaceActionsState,
  type PlaceActionUpdateRequest,
} from "@/lib/contracts/location-place-actions"
import { GOOGLE_PLACE_ACTION_TYPES, type GooglePlaceActionType } from "@/lib/domain/google-contract"

import { apiFetch, type RequestOptions } from "./client"

export type { PlaceActionLink, PlaceActionMutationOutcome, PlaceActionsState }

export const PLACE_ACTION_TYPES = GOOGLE_PLACE_ACTION_TYPES
export type PlaceActionType = GooglePlaceActionType

export function fetchPlaceActions(id: string, options?: RequestOptions): Promise<PlaceActionsState> {
  return apiFetch(`/api/locations/${id}/place-actions`, {
    schema: placeActionsResponseSchema,
    ...options,
  }).then((r) => r.placeActions)
}

export function createPlaceAction(id: string, input: PlaceActionInput) {
  return apiFetch(`/api/locations/${id}/place-actions`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_place_action" },
    schema: placeActionMutationOutcomeSchema,
  })
}

export function updatePlaceAction(id: string, linkId: string, input: Omit<PlaceActionUpdateRequest, "confirmation">) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_place_action" },
    schema: placeActionMutationOutcomeSchema,
  })
}

export function deletePlaceAction(id: string, linkId: string, input: Omit<PlaceActionDeleteRequest, "confirmation">) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_place_action" },
    schema: placeActionMutationOutcomeSchema,
  })
}
