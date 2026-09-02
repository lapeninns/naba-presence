import {
  INDUSTRY_CONFIRMATION,
  industryMutationResultSchema,
  industryResponseSchema,
  type IndustryMutation,
  type IndustryOperation,
  type IndustryState,
} from "@/lib/contracts/location-industry"

import { apiFetch, type RequestOptions } from "./client"

export type { IndustryOperation, IndustryState, SectionResult } from "@/lib/contracts/location-industry"

export function fetchIndustry(id: string, options?: RequestOptions): Promise<IndustryState> {
  return apiFetch(`/api/locations/${id}/industry`, {
    schema: industryResponseSchema,
    ...options,
  }).then((r) => r.industry)
}

export function publishIndustry(
  id: string,
  input: { operation: IndustryOperation; updateMask: string[]; payload: Record<string, unknown> }
) {
  // The editor builds the mask/payload from freeform Google leaves; the route
  // narrows them per operation (e.g. business calls) before anything is sent on.
  const body = { operation: input.operation, confirmation: INDUSTRY_CONFIRMATION, updateMask: input.updateMask, payload: input.payload } satisfies Record<keyof IndustryMutation, unknown>
  return apiFetch(`/api/locations/${id}/industry`, {
    method: "PATCH",
    body,
    schema: industryMutationResultSchema,
  })
}
