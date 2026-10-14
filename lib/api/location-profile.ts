import {
  profileOperationResponseSchema,
  profileResponseSchema,
  saveProfileResponseSchema,
  type ProfileOperationInput,
  type ProfileOperationResponse,
  type ProfileState,
  type SaveProfileInput,
  type SaveProfileResponse,
} from "@/lib/contracts/location-profile"

import { apiFetch, type MutationOptions, type RequestOptions } from "./client"

export type {
  ProfileField,
  ProfileFieldKey,
  ProfileOperationInput,
  ProfileOperationResponse,
  ProfileState,
  SaveProfileInput,
  SaveProfileResponse,
} from "@/lib/contracts/location-profile"

/**
 * The profile editor's state. Within the editor's staleness budget the
 * server answers from its last Google read (`source: "stored"`); `refresh`
 * reads Google now.
 */
export function fetchProfile(
  id: string,
  options?: RequestOptions,
  params: { refresh?: boolean } = {}
): Promise<ProfileState> {
  const suffix = params.refresh ? "?refresh=1" : ""
  return apiFetch(`/api/locations/${id}/profile${suffix}`, {
    schema: profileResponseSchema,
    ...options,
  }).then((r) => r.profile)
}

export function saveProfile(id: string, input: SaveProfileInput): Promise<SaveProfileResponse> {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "PUT",
    body: input,
    schema: saveProfileResponseSchema,
  })
}

export function runProfileOperation(
  id: string,
  input: ProfileOperationInput,
  options: MutationOptions = {}
): Promise<ProfileOperationResponse> {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "POST",
    body: input,
    schema: profileOperationResponseSchema,
    intentId: options.intentId,
  })
}
