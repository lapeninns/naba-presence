// Client-safe: zod only. The lodging preview request (which validates against
// the Google lodging discovery schema) lives in `./lodging-preview`.
import { z } from "zod"

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
