import {
  ADMINISTRATION_CONFIRMATIONS,
  administrationMatchResponseSchema,
  administrationMutationResultSchema,
  administrationResponseSchema,
  type AdministrationMatchBody,
  type AdministrationMatchResponse,
  type AdministrationMutation,
  type AdministrationOperation,
  type AdministrationState,
} from "@/lib/contracts/location-administration"

import { apiFetch, type RequestOptions } from "./client"

export {
  ADMINISTRATION_CONFIRMATIONS,
  DANGER_ZONE_OPERATIONS,
  type AdministrationOperation,
  type AdministrationState,
  type SectionResult,
} from "@/lib/contracts/location-administration"

export function fetchAdministration(id: string, options?: RequestOptions): Promise<AdministrationState> {
  return apiFetch(`/api/locations/${id}/administration`, {
    schema: administrationResponseSchema,
    ...options,
  }).then((r) => r.administration)
}

export function matchGoogleLocation(id: string, location: Record<string, unknown>): Promise<AdministrationMatchResponse> {
  const body: AdministrationMatchBody = { operation: "match_location", location }
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "POST",
    body,
    schema: administrationMatchResponseSchema,
  })
}

export function runAdministrationOperation(
  id: string,
  input: { operation: AdministrationOperation; payload?: Record<string, unknown> }
) {
  const body: AdministrationMutation = {
    operation: input.operation,
    confirmation: ADMINISTRATION_CONFIRMATIONS[input.operation],
    payload: input.payload ?? {},
  }
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "PATCH",
    body,
    schema: administrationMutationResultSchema,
  })
}
