import {
  googleChangeCheckResponseSchema,
  googleChangeDecisionResponseSchema,
  googleChangesResponseSchema,
  googleWatchSettingsResponseSchema,
  type GoogleChangeDecisionInput,
  type GoogleWatchSettingsInput,
} from "@/lib/contracts/google-change-watch"

import { apiFetch, type MutationOptions, type RequestOptions } from "./client"

// The Google change watch (S5). Shapes live in
// lib/contracts/google-change-watch.ts.

export function fetchGoogleChanges(id: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/google-changes`, {
    schema: googleChangesResponseSchema,
    ...options,
  })
}

export function checkGoogleChanges(id: string) {
  return apiFetch(`/api/locations/${id}/google-changes/check`, {
    method: "POST",
    schema: googleChangeCheckResponseSchema,
  })
}

export function decideGoogleChange(
  id: string,
  changeId: string,
  input: GoogleChangeDecisionInput,
  options: MutationOptions = {}
) {
  return apiFetch(`/api/locations/${id}/google-changes/${changeId}`, {
    method: "POST",
    body: input,
    schema: googleChangeDecisionResponseSchema,
    intentId: options.intentId,
  })
}

export function fetchGoogleWatchSettings(id: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/google-watch`, {
    schema: googleWatchSettingsResponseSchema,
    ...options,
  })
}

export function saveGoogleWatchSettings(
  id: string,
  input: GoogleWatchSettingsInput
) {
  return apiFetch(`/api/locations/${id}/google-watch`, {
    method: "PUT",
    body: input,
    schema: googleWatchSettingsResponseSchema,
  })
}
