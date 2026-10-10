import { z } from "zod"
import { GOOGLE_CAPABILITY_REASONS } from "@/lib/domain/google-capabilities"

export const googleResourceActionSchema = z.object({
  resource: z.string(),
  action: z.string(),
  providerMethod: z.string().nullable(),
  support: z.enum(["supported", "read_only", "external", "retired"]),
  mode: z.enum(["read", "write", "handoff"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown", "not_applicable"]),
  eligibilitySource: z.string(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  reasonCode: z.enum(GOOGLE_CAPABILITY_REASONS).optional(),
  documentation: z.url(),
  documentationCheckedAt: z.iso.date(),
  observedAt: z.iso.datetime().nullable(),
  handoffUrl: z.url().optional(),
})
export type GoogleResourceAction = z.infer<typeof googleResourceActionSchema>

export const googleResourceActionsSchema = z.object({
  version: z.string(),
  actions: z.record(z.string(), googleResourceActionSchema),
})
export type GoogleResourceActions = z.infer<typeof googleResourceActionsSchema>
