// Contract for /api/locations/[id]/industry. Client-safe: zod only.
import { z } from "zod"

import { gbpMutationWithResponseResultSchema, sectionResultSchema } from "./gbp-management"

export { sectionResultSchema, type SectionResult } from "./gbp-management"

// --- GET ------------------------------------------------------------------

export const industryStateSchema = z.object({
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

export const industryResponseSchema = z.object({ industry: industryStateSchema })
export type IndustryResponse = z.infer<typeof industryResponseSchema>

// --- PATCH ----------------------------------------------------------------

export const INDUSTRY_OPERATIONS = [
  "update_lodging",
  "update_business_calls",
  "update_healthcare_services",
  "update_healthcare_provider_attributes",
] as const
export const industryOperationSchema = z.enum(INDUSTRY_OPERATIONS)
export type IndustryOperation = z.infer<typeof industryOperationSchema>

export const INDUSTRY_CONFIRMATION = "publish_industry_data_to_google" as const

/** The only Business Calls leaf the editor writes; the mask is pinned to it. */
export const businessCallsLeafSchema = z.object({
  callsState: z.enum(["ENABLED", "DISABLED"]),
})
export type BusinessCallsLeaf = z.infer<typeof businessCallsLeafSchema>

const freeformMask = z.array(z.string().trim().min(1)).min(1)
const freeformPayload = z.record(z.string(), z.unknown())

export const industryMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("update_lodging"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: freeformMask,
    payload: freeformPayload,
  }),
  z.object({
    operation: z.literal("update_business_calls"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: z.array(z.literal("callsState")).min(1).max(1),
    payload: businessCallsLeafSchema,
  }),
  z.object({
    operation: z.literal("update_healthcare_services"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: freeformMask,
    payload: freeformPayload,
  }),
  z.object({
    operation: z.literal("update_healthcare_provider_attributes"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: freeformMask,
    payload: freeformPayload,
  }),
])
export type IndustryMutation = z.infer<typeof industryMutationSchema>

export const industryMutationResultSchema = gbpMutationWithResponseResultSchema
export type IndustryMutationResult = z.infer<typeof industryMutationResultSchema>
