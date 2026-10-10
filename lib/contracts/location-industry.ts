// Contract for /api/locations/[id]/industry. Client-safe: zod only.
import { z } from "zod"

import {
  lodgingMaskCoversPayload,
  lodgingUpdateMaskSchema,
  lodgingUpdatePayloadSchema,
} from "@/lib/domain/lodging"

import { gbpMutationWithResponseResultSchema, sectionResultSchema } from "./gbp-management"

export { sectionResultSchema, type SectionResult } from "./gbp-management"

// --- GET ------------------------------------------------------------------

export const industryStateSchema = z.object({
  lodging: sectionResultSchema,
  lodgingUpdated: sectionResultSchema,
  healthcareServices: sectionResultSchema,
  /**
   * stableGoogleHash of the lodging resource as loaded (null when it could
   * not be). A lodging update sends it back as its expected baseline.
   */
  lodgingHash: z.string().length(64).nullable().default(null),
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
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

/**
 * A lodging update: allowlisted groups only (lib/domain/lodging.ts), the
 * mask and payload naming the same groups, and the hash of the lodging the
 * editor loaded. The server refuses it as stale when a group it writes has
 * changed on Google since; changes to other groups do not block it.
 */
export const lodgingMutationSchema = z
  .object({
    operation: z.literal("update_lodging"),
    confirmation: z.literal(INDUSTRY_CONFIRMATION),
    updateMask: lodgingUpdateMaskSchema,
    payload: lodgingUpdatePayloadSchema,
    expectedGoogleHash: z.string().length(64),
  })
  .refine(
    (body) =>
      lodgingMaskCoversPayload(
        body.updateMask,
        body.payload as Record<string, unknown>
      ),
    {
      message: "The lodging changes and the fields they update do not match.",
      path: ["updateMask"],
    }
  )

// Healthcare serviceList stays freeform pending decision D-24.
export const industryMutationSchema = z.discriminatedUnion("operation", [
  lodgingMutationSchema,
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
