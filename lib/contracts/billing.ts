/**
 * Billing wire shapes (plan P07): the organisation's billing state, a plan
 * catalog entry and the derived access. Client-safe; the vocabulary comes
 * from lib/domain/entitlements.ts, which is pure.
 */
import { z } from "zod"

import {
  ACCESS_MODES,
  ACCESS_REASONS,
  BILLING_STATES,
} from "@/lib/domain/entitlements"

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
  mode: z.enum(ACCESS_MODES),
  reason: z.enum(ACCESS_REASONS),
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

/**
 * GET `/api/billing/reconcile` query (the hourly Vercel Cron page). The
 * walk resumes from `cron_cursor` ('billing') when no cursor is given.
 */
export const billingReconcileSchema = z.object({
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(500).default(100),
})
export type BillingReconcileInput = z.input<typeof billingReconcileSchema>

/**
 * POST `/api/billing/checkout` (plan P07-S5). The plan is the only input,
 * and the server resolves its price from the catalog allowlist. Strict: a
 * price id, customer id or anything else a client adds is refused, never
 * passed on to Stripe.
 */
export const checkoutInputSchema = z.strictObject({ planId: z.uuid() })
export type CheckoutInput = z.infer<typeof checkoutInputSchema>

export const checkoutResultSchema = z.object({
  /** Stripe Checkout's hosted page; the client navigates to it. */
  url: z.url(),
  /** ISO timestamp the session stops accepting payment. */
  expiresAt: z.string(),
  /** True when an open session for the same plan was handed back. */
  reused: z.boolean(),
  /** Whether the subscription starts with the card-required trial. */
  trialDays: z.number().int().min(0),
})
export type CheckoutResult = z.infer<typeof checkoutResultSchema>

/** POST `/api/billing/portal`. */
export const portalResultSchema = z.object({ url: z.url() })
export type PortalResult = z.infer<typeof portalResultSchema>

/**
 * POST `/api/billing/plan-change`: the plan to bill from the next period
 * boundary, without proration. The current plan cancels a scheduled change.
 */
export const planChangeInputSchema = z.strictObject({ planId: z.uuid() })
export type PlanChangeInput = z.infer<typeof planChangeInputSchema>

export const planChangeResultSchema = z.object({
  outcome: z.enum(["scheduled", "cleared", "unchanged"]),
  pendingPlanId: z.uuid().nullable(),
  /** ISO timestamp; null when no change is scheduled. */
  pendingEffectiveAt: z.string().nullable(),
})
export type PlanChangeResult = z.infer<typeof planChangeResultSchema>

/** POST `/api/billing/cancel`: cancel at period end (true) or resume. */
export const cancelInputSchema = z.strictObject({
  cancelAtPeriodEnd: z.boolean(),
})
export type CancelInput = z.infer<typeof cancelInputSchema>

export const cancelResultSchema = z.object({
  outcome: z.enum(["updated", "unchanged"]),
  cancelAtPeriodEnd: z.boolean(),
  /** A plan change that cancelling dropped, if any. */
  clearedPendingPlan: z.boolean(),
})
export type CancelResult = z.infer<typeof cancelResultSchema>

/** Why checkout cannot start right now (503 billing_unavailable reasons). */
export const CHECKOUT_UNAVAILABLE_REASONS = [
  "billing_disabled",
  "secret_key_missing",
  "webhook_secret_missing",
  "secret_key_unrecognised",
  "secret_key_mode_mismatch",
  "billing_paused",
  "app_url_missing",
  "live_terms_missing",
  "live_tax_missing",
  "catalog_empty",
] as const

/** GET `/api/billing`: the organisation's billing, access and catalog. */
export const billingOverviewSchema = z.object({
  state: billingStateSchema.nullable(),
  environment: billingEnvironmentSchema.nullable(),
  plan: planSchema.nullable(),
  pendingPlan: planSchema.nullable(),
  /** ISO timestamps. */
  pendingEffectiveAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  hasCustomer: z.boolean(),
  /**
   * ISO timestamp the record last took the provider's state (the webhook
   * processor or the hourly reconciliation); null before the first sync.
   * The "Confirming subscription" screen waits for it to advance.
   */
  providerSyncedAt: z.string().nullable(),
  /**
   * The trial a new checkout would include, as far as the record knows (no
   * earlier subscription and no paid invoice). Stripe's checkout page shows
   * the final terms; 0 = billing starts at checkout.
   */
  trialDays: z.number().int().min(0),
  /**
   * True when central enforcement applies to this organisation and its
   * access refuses new changes. Read-only access without enforcement still
   * stops new AI work (`access.canUseAi`), but not other changes.
   */
  writesBlocked: z.boolean(),
  /** An unexpired checkout session was started and not yet confirmed. */
  checkoutPending: z
    .object({ planId: z.uuid(), expiresAt: z.string() })
    .nullable(),
  access: accessSchema,
  billableLocations: z.number().int().min(0),
  /** Active plans for the organisation's workspace mode and environment. */
  catalog: z.array(planSchema),
  checkout: z.object({
    available: z.boolean(),
    reason: z.enum(CHECKOUT_UNAVAILABLE_REASONS).nullable(),
  }),
  /** Only the owner may start, change or cancel a subscription. */
  canManage: z.boolean(),
})
export type BillingOverview = z.infer<typeof billingOverviewSchema>
