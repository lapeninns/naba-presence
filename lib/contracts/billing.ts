/**
 * Billing wire shapes (plan P07): the organisation's billing state, a plan
 * catalog entry and the derived access. Client-safe; the vocabulary comes
 * from lib/domain/entitlements.ts, which is pure.
 */
import { z } from "zod"

import { BILLING_STATES } from "@/lib/domain/entitlements"

export const billingStateSchema = z.enum(BILLING_STATES)
export type BillingStateValue = z.infer<typeof billingStateSchema>

export const billingEnvironmentSchema = z.enum(["test", "live"])

/**
 * One `billing_plan` version as shown to a customer. The Stripe price id is
 * server-side only. `isTestOffer` is always true in the test environment,
 * and the UI must mark such an offer visibly.
 */
export const planSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  version: z.number().int().min(1),
  workspaceMode: z.enum(["business", "agency"]),
  environment: billingEnvironmentSchema,
  name: z.string().min(1).max(120),
  locationLimit: z.number().int().min(1),
  memberLimit: z.number().int().min(1).nullable(),
  aiDraftCreditsPerPeriod: z.number().int().min(0),
  isTestOffer: z.boolean(),
  active: z.boolean(),
})
export type Plan = z.infer<typeof planSchema>

export const accessSchema = z.object({
  mode: z.enum(["full", "grace", "read_only"]),
  reason: z.string(),
  canWrite: z.boolean(),
  canUseAi: z.boolean(),
  locationLimit: z.number().int().min(1).nullable(),
  pendingLocationLimit: z.number().int().min(1).nullable(),
  newLinkLimit: z.number().int().min(1).nullable(),
  memberLimit: z.number().int().min(1).nullable(),
  /** ISO timestamp. */
  endsAt: z.string().nullable(),
})
export type AccessView = z.infer<typeof accessSchema>
