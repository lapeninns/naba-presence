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

import { apiFetch, type MutationOptions, type RequestOptions } from "./client"

export type {
  GoogleHoursUpdateMask,
  HoursState,
  NormalizedHours,
  PublishHoursInput,
  PublishHoursResponse,
  SaveHoursInput,
  SaveHoursResponse,
} from "@/lib/contracts/location-hours"

/**
 * The hours editor's state. Within the editor's staleness budget the server
 * answers from its last Google read (`source: "stored"`); `refresh` reads
 * Google now.
 */
export function fetchHours(
  id: string,
  options?: RequestOptions,
  params: { refresh?: boolean } = {}
): Promise<HoursState> {
  const suffix = params.refresh ? "?refresh=1" : ""
  return apiFetch(`/api/locations/${id}/hours${suffix}`, {
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

export function publishHours(
  id: string,
  input: PublishHoursInput,
  options: MutationOptions = {}
): Promise<PublishHoursResponse> {
  const body: PublishHoursBody = { confirmation: "publish_nabapresence_hours_to_google", ...input }
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "POST",
    body,
    schema: publishHoursResponseSchema,
    intentId: options.intentId,
  })
}
