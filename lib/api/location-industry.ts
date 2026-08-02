import { z } from "zod"

import { apiFetch } from "./client"

const sectionResultSchema = z.object({ data: z.unknown(), error: z.string().nullable() })
export type SectionResult<T = unknown> = { data: T; error: string | null }

const industryStateSchema = z.object({
  lodging: sectionResultSchema,
  lodgingUpdated: sectionResultSchema,
  calls: sectionResultSchema,
  callInsights: sectionResultSchema,
  healthcareServices: sectionResultSchema,
  providerAttributes: sectionResultSchema,
  insuranceNetworks: sectionResultSchema,
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
})
export type IndustryState = z.infer<typeof industryStateSchema>
export type IndustryOperation =
  | "update_lodging" | "update_business_calls" | "update_healthcare_services" | "update_healthcare_provider_attributes"

export function fetchIndustry(id: string): Promise<IndustryState> {
  return apiFetch(`/api/locations/${id}/industry`, { schema: z.object({ industry: industryStateSchema }) }).then((r) => r.industry)
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function publishIndustry(
  id: string,
  input: { operation: IndustryOperation; updateMask: string[]; payload: Record<string, unknown> }
) {
  return apiFetch(`/api/locations/${id}/industry`, {
    method: "PATCH",
    body: { operation: input.operation, confirmation: "publish_industry_data_to_google", updateMask: input.updateMask, payload: input.payload },
    schema: mutationResultSchema,
  })
}
