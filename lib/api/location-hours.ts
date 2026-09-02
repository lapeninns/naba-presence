import {
  hoursResponseSchema,
  publishHoursResponseSchema,
  saveHoursResponseSchema,
  type HoursState,
  type PublishHoursBody,
  type PublishHoursInput,
  type PublishHoursResponse,
  type SaveHoursInput,
  type SaveHoursResponse,
} from "@/lib/contracts/location-hours"

import { apiFetch, type RequestOptions } from "./client"

export type {
  GoogleHoursUpdateMask,
  HoursState,
  NormalizedHours,
  PublishHoursInput,
  PublishHoursResponse,
  SaveHoursInput,
  SaveHoursResponse,
} from "@/lib/contracts/location-hours"

export function fetchHours(id: string, options?: RequestOptions): Promise<HoursState> {
  return apiFetch(`/api/locations/${id}/hours`, {
    schema: hoursResponseSchema,
    ...options,
  }).then((r) => r.hours)
}

export function saveHours(id: string, input: SaveHoursInput): Promise<SaveHoursResponse> {
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "PUT",
    body: input,
    schema: saveHoursResponseSchema,
  })
}

export function publishHours(id: string, input: PublishHoursInput): Promise<PublishHoursResponse> {
  const body: PublishHoursBody = { confirmation: "publish_nabapresence_hours_to_google", ...input }
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "POST",
    body,
    schema: publishHoursResponseSchema,
  })
}
