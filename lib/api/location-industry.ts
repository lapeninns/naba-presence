import {
  INDUSTRY_CONFIRMATION,
  industryMutationResultSchema,
  industryResponseSchema,
  type IndustryMutation,
  type IndustryOperation,
  type IndustryState,
} from "@/lib/contracts/location-industry"

import { apiFetch, type RequestOptions } from "./client"
import { gbpChangeSetResponseSchema } from "@/lib/contracts/gbp-change-set"
import { lodgingAttemptResponseSchema } from "@/lib/contracts/lodging-attempt"
import { lodgingWorkflowsResponseSchema } from "@/lib/contracts/lodging-workflows"

export type { IndustryOperation, IndustryState, SectionResult } from "@/lib/contracts/location-industry"

export function fetchIndustry(id: string, options?: RequestOptions): Promise<IndustryState> {
  return apiFetch(`/api/locations/${id}/industry`, {
    schema: industryResponseSchema,
    ...options,
  }).then((r) => r.industry)
}

export function confirmIndustry(id: string, mutationId: string) {
  return apiFetch(`/api/locations/${id}/industry`, {
    method: "POST",
    body: { mutationId },
    schema: industryMutationResultSchema,
  })
}

export function fetchLodgingAttempt(id: string, reviewId: string) {
  return apiFetch(`/api/locations/${id}/industry?reviewId=${encodeURIComponent(reviewId)}`, { schema: lodgingAttemptResponseSchema }).then((result) => result.attempt)
}

export function fetchLodgingWorkflows(id: string, cursor?: string) {
  const params = new URLSearchParams({ type: "workflows" })
  if (cursor) params.set("cursor", cursor)
  return apiFetch(`/api/locations/${id}/industry?${params}`, { schema: lodgingWorkflowsResponseSchema })
}

export function previewLodging(id: string, input: { payload: Record<string, unknown>; updateMask: string[]; expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/industry`, { method: "PUT", body: input, schema: gbpChangeSetResponseSchema }).then((result) => result.changeSet)
}

export function approveLodging(id: string, changeSetId: string, expectedPayloadHash: string) {
  return apiFetch(`/api/locations/${id}/industry`, { method: "POST", body: { action: "approve_lodging", changeSetId, expectedPayloadHash }, schema: gbpChangeSetResponseSchema }).then((result) => result.changeSet)
}

export function publishIndustry(
  id: string,
  input: { operation: IndustryOperation; updateMask: string[]; payload: Record<string, unknown>; changeSetId?: string }
) {
  // The editor builds the mask/payload from freeform Google leaves; the route
  // narrows them per operation (e.g. business calls) before anything is sent on.
  const body = { operation: input.operation, confirmation: INDUSTRY_CONFIRMATION, updateMask: input.updateMask, payload: input.payload, ...(input.changeSetId ? { changeSetId: input.changeSetId } : {}) } satisfies Record<keyof IndustryMutation, unknown>
  return apiFetch(`/api/locations/${id}/industry`, {
    method: "PATCH",
    body,
    schema: industryMutationResultSchema,
  })
}
