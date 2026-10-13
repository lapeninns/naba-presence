// Contract for /api/locations/[id]/industry. Client-safe: zod only.
//
// The light half (GET state, operation names, confirmation phrase, mutation
// result) lives in `./location-industry-state` so client code that only reads
// industry state or confirms a mutation doesn't pull in the Google lodging
// discovery schema. This module adds the PATCH envelope, which validates
// lodging payloads against that schema, and re-exports the light half.
import { z } from "zod"

import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import { lodgingSchema } from "./google-lodging"
import { INDUSTRY_CONFIRMATION, type IndustryOperation } from "./location-industry-state"

export * from "./location-industry-state"

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
