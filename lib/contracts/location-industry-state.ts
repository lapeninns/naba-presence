// The client-safe half of the /api/locations/[id]/industry contract: the GET
// state, the operation names, the confirmation phrase and the mutation result.
// Zod only, and nothing that reaches the Google lodging discovery schema, so
// every listing page's activity panel can read it without downloading the
// lodging schema. The PATCH envelope (`industryMutationSchema`), which
// validates lodging payloads against that schema, lives in
// `./location-industry`, which re-exports everything here.
import { z } from "zod"

import { gbpChangeSetSchema } from "./gbp-change-set"

import { gbpMutationWithResponseResultSchema, sectionResultSchema } from "./gbp-management"

export { sectionResultSchema, type SectionResult } from "./gbp-management"

// --- GET ------------------------------------------------------------------

export const industryStateSchema = z.object({
  lodging: sectionResultSchema,
  lodgingUpdated: sectionResultSchema,
  healthcareServices: sectionResultSchema,
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
  lodgingHash: z.string().optional(),
  lodgingChangeSets: z.array(gbpChangeSetSchema).optional(),
})
export type IndustryState = z.infer<typeof industryStateSchema>

export const industryResponseSchema = z.object({ industry: industryStateSchema })
export type IndustryResponse = z.infer<typeof industryResponseSchema>

// --- PATCH ----------------------------------------------------------------

export const INDUSTRY_OPERATIONS = [
  "update_lodging",
  "update_healthcare_services",
] as const
export const industryOperationSchema = z.enum(INDUSTRY_OPERATIONS)
export type IndustryOperation = z.infer<typeof industryOperationSchema>

/**
 * Operations whose Google API has been switched off: the Business Calls API
 * (2023-05-30) and v4 healthProviderAttributes (2024-07-01). They stay in the
 * request schema only so an old client gets the stable 410
 * `google_api_retired` from the route instead of a validation error.
 */
export const RETIRED_INDUSTRY_OPERATIONS = [
  "update_business_calls",
  "update_healthcare_provider_attributes",
] as const
export type RetiredIndustryOperation =
  (typeof RETIRED_INDUSTRY_OPERATIONS)[number]

export const INDUSTRY_CONFIRMATION = "publish_industry_data_to_google" as const

export const industryMutationResultSchema = gbpMutationWithResponseResultSchema
export type IndustryMutationResult = z.infer<typeof industryMutationResultSchema>

export const industryConfirmationRequestSchema = z.object({ mutationId: z.uuid() })
