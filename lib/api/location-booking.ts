import { z } from "zod"

import { GOOGLE_PLACE_ACTION_TYPES, type GooglePlaceActionType } from "@/lib/domain/google-contract"

import { apiFetch } from "./client"

const linkSchema = z.object({
  id: z.string(),
  googleLinkName: z.string(),
  providerType: z.string(),
  isEditable: z.boolean(),
  uri: z.string(),
  placeActionType: z.string(),
  isPreferred: z.boolean(),
  googleHash: z.string(),
  observedAt: z.string(),
})
export type PlaceActionLink = z.infer<typeof linkSchema>

const placeActionsStateSchema = z.object({
  locationId: z.string(),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  supportedTypes: z.array(z.string()),
  links: z.array(linkSchema),
  latestMutation: z
    .object({ id: z.string(), operation: z.string(), status: z.string(), createdAt: z.string(), finishedAt: z.string().nullable() })
    .nullable(),
})
export type PlaceActionsState = z.infer<typeof placeActionsStateSchema>

export const PLACE_ACTION_TYPES = GOOGLE_PLACE_ACTION_TYPES
export type PlaceActionType = GooglePlaceActionType

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function fetchPlaceActions(id: string): Promise<PlaceActionsState> {
  return apiFetch(`/api/locations/${id}/place-actions`, { schema: z.object({ placeActions: placeActionsStateSchema }) }).then(
    (r) => r.placeActions
  )
}

export function createPlaceAction(id: string, input: { uri: string; placeActionType: PlaceActionType; isPreferred: boolean }) {
  return apiFetch(`/api/locations/${id}/place-actions`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_place_action" },
    schema: mutationResultSchema,
  })
}

export function updatePlaceAction(
  id: string,
  linkId: string,
  input: { uri: string; placeActionType: PlaceActionType; isPreferred: boolean; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_place_action" },
    schema: mutationResultSchema,
  })
}

export function deletePlaceAction(id: string, linkId: string, input: { expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_place_action" },
    schema: mutationResultSchema,
  })
}
