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

import { apiFetch, type RequestOptions } from "./client"

export type {
  ProfileField,
  ProfileFieldKey,
  ProfileOperationInput,
  ProfileOperationResponse,
  ProfileState,
  SaveProfileInput,
  SaveProfileResponse,
} from "@/lib/contracts/location-profile"

export function fetchProfile(id: string, options?: RequestOptions): Promise<ProfileState> {
  return apiFetch(`/api/locations/${id}/profile`, {
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

export function runProfileOperation(id: string, input: ProfileOperationInput): Promise<ProfileOperationResponse> {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "POST",
    body: input,
    schema: profileOperationResponseSchema,
  })
}
