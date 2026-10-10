import { z } from "zod"

import { lodgingSchema } from "./google-lodging"
import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"

export const lodgingUpdateMaskSchema = z.array(z.string().refine((path) => GOOGLE_LODGING_UPDATE_PATHS.has(path), "Select a supported writable lodging field.")).min(1)

export const lodgingPreviewRequestSchema = z.object({
  expectedGoogleHash: z.string().length(64),
  payload: lodgingSchema,
  updateMask: lodgingUpdateMaskSchema,
})

export const gbpChangeSetSchema = z.object({
  id: z.uuid(),
  locationName: z.string(),
  targetResourceName: z.string().optional(),
  payloadHash: z.string(),
  baselineHash: z.string(),
  payload: z.record(z.string(), z.unknown()),
  baseline: z.record(z.string(), z.unknown()),
  updateMask: z.array(z.string()),
  requestedBy: z.string(),
  approvedBy: z.string().nullable(),
  requiresSecondApprover: z.boolean(),
  canApprove: z.boolean(),
  expiresAt: z.string(),
})
export type GbpChangeSet = z.infer<typeof gbpChangeSetSchema>
export const gbpChangeSetResponseSchema = z.object({ changeSet: gbpChangeSetSchema })
export const gbpChangeSetsResponseSchema = z.object({ changeSets: z.array(gbpChangeSetSchema) })
export const approveGbpChangeSetRequestSchema = z.object({
  action: z.literal("approve_lodging"),
  changeSetId: z.uuid(),
  expectedPayloadHash: z.string().length(64),
})
