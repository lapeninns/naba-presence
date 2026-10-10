// Contract for /api/locations/[id]/industry. Client-safe: zod only.
import { z } from "zod"

import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import { lodgingSchema } from "./google-lodging"
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

const freeformMask = z.array(z.string().trim().min(1)).min(1)
const freeformPayload = z.record(z.string(), z.unknown())

export const industryMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("update_lodging"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: z.array(z.string().refine((path) => GOOGLE_LODGING_UPDATE_PATHS.has(path), "Select a supported writable lodging field.")).min(1),
    payload: lodgingSchema,
    changeSetId: z.uuid().optional(),
  }),
  z.object({
    operation: z.literal("update_healthcare_services"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: freeformMask,
    payload: freeformPayload,
  }),
  // Retired: only the operation is read; the route answers 410.
  z.object({ operation: z.literal("update_business_calls") }),
  z.object({ operation: z.literal("update_healthcare_provider_attributes") }),
])
export type IndustryMutation = z.infer<typeof industryMutationSchema>
/** A mutation the server will still carry out. */
export type SupportedIndustryMutation = Extract<
  IndustryMutation,
  { operation: IndustryOperation }
>

export const industryMutationResultSchema = gbpMutationWithResponseResultSchema
export type IndustryMutationResult = z.infer<typeof industryMutationResultSchema>

export const industryConfirmationRequestSchema = z.object({ mutationId: z.uuid() })
