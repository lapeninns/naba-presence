import { z } from "zod"

export const observedVerificationSchema = z.object({
  name: z.string().max(512),
  method: z.string().max(64).nullable(),
  providerState: z.string().max(64).nullable(),
  phase: z.enum(["pending", "completed", "failed", "unknown"]),
  createTime: z.iso.datetime({ offset: true }).nullable(),
})
export type ObservedVerification = z.infer<typeof observedVerificationSchema>

export const observedMerchantStateSchema = z.object({
  hasVoiceOfMerchant: z.boolean().nullable(),
  hasBusinessAuthority: z.boolean().nullable(),
  action: z.enum(["none", "wait", "verify", "ownership_conflict", "guidelines", "unknown"]),
  hasPendingVerification: z.boolean().nullable(),
})
export type ObservedMerchantState = z.infer<typeof observedMerchantStateSchema>

export const verificationStateResponseSchema = z.object({
  locationId: z.uuid(), googleLocationName: z.string(), checkedAt: z.iso.datetime(),
  verifications: z.array(observedVerificationSchema).max(2000),
  merchant: observedMerchantStateSchema.nullable(),
  merchantError: z.literal("verification_merchant_state_unavailable").nullable(),
})
export type VerificationStateResponse = z.infer<typeof verificationStateResponseSchema>
