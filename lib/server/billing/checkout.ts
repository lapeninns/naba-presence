import "server-only"

import { createHash } from "node:crypto"

import type Stripe from "stripe"
import type { TransactionSql } from "postgres"

import type {
  CheckoutResult,
  PortalResult,
  CHECKOUT_UNAVAILABLE_REASONS,
} from "@/lib/contracts/billing"
import {
  RUNNING_SUBSCRIPTION_STATUSES,
  TRIAL_DAYS,
} from "@/lib/domain/billing-lifecycle"
import type { BillingState } from "@/lib/domain/entitlements"
import { writeAudit } from "@/lib/server/audit"
import { listCatalog, requireOfferedPlan } from "@/lib/server/billing/catalog"
import {
  lockOrganisationBilling,
  getOrganisationBilling,
  type OrganisationBilling,
} from "@/lib/server/billing/state"
import {
  billingConfig,
  billingUnavailable,
  getStripe,
  type BillingConfig,
  type BillingEnvironment,
} from "@/lib/server/billing/stripe"
import { getServerEnv, type ServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  loadPauseSnapshot,
  scopesEnabled,
  type PauseSnapshot,
} from "@/lib/server/pause-controls"
import type { TenantRunner } from "@/lib/server/route"

/**
 * Starting a subscription and opening the Customer Portal (plan P07-S5).
 *
 * Server-authoritative and fail-closed:
 *   - nothing reaches Stripe unless billing is configured
 *     (lib/server/billing/stripe.ts billingConfig), the operator `billing`
 *     pause scope is open, the app's own URL is known for the return pages
 *     and, in the LIVE environment, the approved terms (BILLING_TERMS_URL)
 *     and Stripe Tax (BILLING_AUTOMATIC_TAX) are both in place. Otherwise
 *     503 `billing_unavailable` with the reason;
 *   - the plan comes from the catalog allowlist (lib/server/billing/catalog.ts)
 *     and its price never leaves the server; with no plan on offer at all,
 *     checkout is unavailable (503, `catalog_empty`);
 *   - the Stripe customer is the organisation's own (created here, once,
 *     under the billing row lock, and committed before any session exists);
 *   - one open Checkout session per organisation (0227): a repeat for the
 *     same plan reuses it, another plan expires it first;
 *   - a subscription that is already running, here or at Stripe, is refused
 *     (409 `subscription_exists`);
 *   - nothing is granted on the way back from Checkout. A pilot stays a
 *     pilot until the webhook processor (P07-S4) reads the new subscription
 *     from Stripe; that sync is also what closes the pilot's month.
 *
 * Stripe calls carry idempotency keys derived from the organisation, the
 * plan, the billing record's version and a fingerprint of the request body,
 * so a retry of the same step can never create a second customer or session
 * and a retry whose body differs (another owner's email, a lost trial) gets
 * its own key instead of Stripe's idempotency_error. The session's expiry is
 * rounded to a window so that a retry after a rolled-back transaction sends
 * the same body and Stripe replays the session it already made.
 */

export type CheckoutUnavailableReason =
  (typeof CHECKOUT_UNAVAILABLE_REASONS)[number]

/** How long a Checkout session stays payable (Stripe allows 30 min-24 h). */
export const CHECKOUT_SESSION_TTL_SECONDS = 60 * 60
/**
 * The expiry is rounded up to this window, so requests in one window send
 * the same body. The session stays payable for TTL to TTL + window.
 */
export const CHECKOUT_EXPIRY_WINDOW_SECONDS = 10 * 60
/** An open session this close to expiry is replaced rather than reused. */
const REUSE_MARGIN_MS = 5 * 60 * 1000

/** The page Checkout and the portal return to (the owner Billing screen). */
export const BILLING_RETURN_PATH = "/settings/billing"

/** States in which the organisation already has a running subscription. */
export const SUBSCRIBED_STATES: readonly BillingState[] = [
  "trialing",
  "active",
  "past_due",
  "grace",
]

/** The Checkout `expires_at` for a request made at `now` (unix seconds). */
export function checkoutExpiresAt(now: Date): number {
  const window = Math.floor(
    now.getTime() / 1000 / CHECKOUT_EXPIRY_WINDOW_SECONDS
  )
  return (
    (window + 1) * CHECKOUT_EXPIRY_WINDOW_SECONDS + CHECKOUT_SESSION_TTL_SECONDS
  )
}

/**
 * A short fingerprint of a Stripe request body for its idempotency key:
 * Stripe refuses a key reused with different parameters, so a body that
 * differs must never share a key. Bodies are built in a fixed key order.
 */
export function requestFingerprint(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 16)
}

export type BillingReadiness =
  | {
      ok: true
      config: Extract<BillingConfig, { ok: true }>
      appUrl: string
    }
  | { ok: false; reason: CheckoutUnavailableReason }

/**
 * Whether billing actions may reach Stripe now. `forCheckout` adds the
 * live-only requirements (terms and tax) that only selling needs.
 */
export function billingReadiness(options: {
  env?: ServerEnv
  pauses: PauseSnapshot
  forCheckout: boolean
}): BillingReadiness {
  const env = options.env ?? getServerEnv()
  const config = billingConfig(env)
  if (!config.ok) return { ok: false, reason: config.reason }
  if (!scopesEnabled(env, options.pauses, ["billing"])) {
    return { ok: false, reason: "billing_paused" }
  }
  if (!env.NEXTAUTH_URL) return { ok: false, reason: "app_url_missing" }
  if (options.forCheckout && config.environment === "live") {
    if (!env.BILLING_TERMS_URL) {
      return { ok: false, reason: "live_terms_missing" }
    }
    if (!env.BILLING_AUTOMATIC_TAX) {
      return { ok: false, reason: "live_tax_missing" }
    }
  }
  return { ok: true, config, appUrl: new URL(env.NEXTAUTH_URL).origin }
}

/** billingReadiness, throwing 503 `billing_unavailable` when not ready. */
export async function requireBillingReady(
  forCheckout: boolean
): Promise<Extract<BillingReadiness, { ok: true }>> {
  const readiness = billingReadiness({
    pauses: await loadPauseSnapshot(),
    forCheckout,
  })
  if (!readiness.ok) throw billingUnavailable(readiness.reason)
  return readiness
}

export function subscriptionExists(): ApiError {
  return new ApiError(
    409,
    "subscription_exists",
    "This workspace already has a subscription. Manage it from the billing page."
  )
}

function checkoutCompleted(): ApiError {
  return new ApiError(
    409,
    "checkout_completed",
    "Checkout has been completed and the subscription is being confirmed."
  )
}

function billingMissing(): ApiError {
  return new ApiError(
    409,
    "billing_missing",
    "This workspace has no billing record. Contact support."
  )
}

export async function workspaceModeOf(
  sql: TransactionSql,
  organisationId: string
): Promise<"business" | "agency"> {
  const [row] = await sql<{ mode: "business" | "agency" }[]>`
    select workspace_mode as mode from organisation where id = ${organisationId}
  `
  if (!row) throw billingMissing()
  return row.mode
}

type OpenCheckout = { sessionId: string; planId: string; expiresAt: Date }

export async function readOpenCheckout(
  sql: TransactionSql,
  organisationId: string
): Promise<OpenCheckout | null> {
  const [row] = await sql<
    {
      sessionId: string | null
      planId: string | null
      expiresAt: Date | null
    }[]
  >`
    select
      checkout_session_id as "sessionId",
      checkout_plan_id::text as "planId",
      checkout_expires_at as "expiresAt"
    from organisation_billing
    where organisation_id = ${organisationId}
  `
  if (!row?.sessionId || !row.planId || !row.expiresAt) return null
  return {
    sessionId: row.sessionId,
    planId: row.planId,
    expiresAt: row.expiresAt,
  }
}

type LockedContext = {
  billing: OrganisationBilling
  workspaceMode: "business" | "agency"
}

/** The locked record, refusing an organisation already subscribed. */
async function lockForCheckout(
  sql: TransactionSql,
  organisationId: string,
  environment: BillingEnvironment
): Promise<LockedContext> {
  const view = await lockOrganisationBilling(sql, organisationId)
  if (!view.billing) throw billingMissing()
  if (SUBSCRIBED_STATES.includes(view.billing.state)) {
    throw subscriptionExists()
  }
  const workspaceMode = await workspaceModeOf(sql, organisationId)
  const catalog = await listCatalog(sql, { workspaceMode, environment })
  if (catalog.length === 0) throw billingUnavailable("catalog_empty")
  return { billing: view.billing, workspaceMode }
}

export type CheckoutActor = {
  organisationId: string
  organisationName: string
  userId: string
  email: string
}

/**
 * Starts (or resumes) the organisation's Checkout session for `planId` and
 * returns the hosted page to send the owner to. `stripe` is injectable for
 * tests; routes use the configured client.
 */
export async function startCheckout(options: {
  tenant: TenantRunner
  actor: CheckoutActor
  planId: string
  requestId: string
  stripe?: Stripe
  now?: () => Date
}): Promise<CheckoutResult> {
  const { tenant, actor, planId, requestId } = options
  const now = options.now ?? (() => new Date())
  const ready = await requireBillingReady(true)
  const { environment } = ready.config
  const stripe = options.stripe ?? getStripe()
  const env = getServerEnv()
  const organisationId = actor.organisationId

  // 1. The organisation's Stripe customer, committed on its own so a
  //    failure creating the session can never orphan a second customer.
  await tenant(async (sql) => {
    const { billing, workspaceMode } = await lockForCheckout(
      sql,
      organisationId,
      environment
    )
    await requireOfferedPlan(sql, planId, { workspaceMode, environment })
    if (billing.stripeCustomerId) return
    const customerParams: Stripe.CustomerCreateParams = {
      name: actor.organisationName,
      email: actor.email,
      metadata: { organisation_id: organisationId },
    }
    const customer = await stripe.customers.create(customerParams, {
      idempotencyKey: `naba:customer:${organisationId}:v${billing.version}:${requestFingerprint(customerParams)}`,
    })
    await sql`
      update organisation_billing
      set stripe_customer_id = ${customer.id},
        version = version + 1,
        updated_at = now()
      where organisation_id = ${organisationId}
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: actor.userId,
      action: "billing.customer_created",
      subjectType: "organisation_billing",
      subjectId: organisationId,
      requestId,
      metadata: { customerId: customer.id },
    })
  })

  // 2. The session, under the lock again: the state may have moved.
  return tenant(async (sql) => {
    const { billing, workspaceMode } = await lockForCheckout(
      sql,
      organisationId,
      environment
    )
    const plan = await requireOfferedPlan(sql, planId, {
      workspaceMode,
      environment,
    })
    const customerId = billing.stripeCustomerId
    if (!customerId) throw billingMissing()

    // A subscription Stripe already runs for this customer (a checkout
    // completed before its webhook arrived, an unpaid one) is not replaced.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    })
    if (
      subscriptions.data.some((subscription) =>
        RUNNING_SUBSCRIPTION_STATUSES.includes(subscription.status)
      )
    ) {
      throw subscriptionExists()
    }
    // The card-required trial is for a first subscription only.
    const trialEligible =
      billing.stripeSubscriptionId === null &&
      !billing.firstPaymentSucceeded &&
      subscriptions.data.every(
        (subscription) => subscription.status === "incomplete_expired"
      )
    const trialDays = trialEligible ? TRIAL_DAYS : 0

    const open = await readOpenCheckout(sql, organisationId)
    if (open) {
      const fresh = open.expiresAt.getTime() - now().getTime() > REUSE_MARGIN_MS
      if (open.planId === plan.id && fresh) {
        const existing = await stripe.checkout.sessions.retrieve(open.sessionId)
        if (existing.status === "complete") throw checkoutCompleted()
        if (existing.status === "open" && existing.url) {
          return {
            url: existing.url,
            expiresAt: open.expiresAt.toISOString(),
            reused: true,
            trialDays,
          }
        }
      } else {
        await expireSession(stripe, open.sessionId)
      }
    }

    const expiresAt = checkoutExpiresAt(now())
    const metadata = { organisation_id: organisationId, plan_id: plan.id }
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: customerId,
      client_reference_id: organisationId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      // Card required, trial or not.
      payment_method_collection: "always",
      subscription_data: {
        metadata,
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
      metadata,
      success_url: `${ready.appUrl}${BILLING_RETURN_PATH}?checkout=returned`,
      cancel_url: `${ready.appUrl}${BILLING_RETURN_PATH}?checkout=canceled`,
      expires_at: expiresAt,
      ...(env.BILLING_AUTOMATIC_TAX
        ? {
            automatic_tax: { enabled: true },
            customer_update: { address: "auto", name: "auto" },
          }
        : {}),
      ...(env.BILLING_TERMS_URL
        ? { consent_collection: { terms_of_service: "required" } }
        : {}),
    }
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `naba:checkout:${organisationId}:${plan.id}:v${billing.version}:${requestFingerprint(sessionParams)}`,
    })
    if (!session.url) throw billingUnavailable("checkout_url_missing")
    const sessionExpiresAt = new Date((session.expires_at ?? expiresAt) * 1000)
    await sql`
      update organisation_billing
      set checkout_session_id = ${session.id},
        checkout_plan_id = ${plan.id},
        checkout_expires_at = ${sessionExpiresAt},
        version = version + 1,
        updated_at = now()
      where organisation_id = ${organisationId}
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: actor.userId,
      action: "billing.checkout_started",
      subjectType: "organisation_billing",
      subjectId: organisationId,
      requestId,
      metadata: {
        planId: plan.id,
        planCode: plan.code,
        planVersion: plan.version,
        sessionId: session.id,
        trialDays,
        fromState: billing.state,
        testOffer: plan.isTestOffer,
      },
    })
    return {
      url: session.url,
      expiresAt: sessionExpiresAt.toISOString(),
      reused: false,
      trialDays,
    }
  })
}

/**
 * Expires a superseded session so it can no longer be paid. One that was
 * completed meanwhile means a subscription is on its way: refuse. One that
 * already expired is fine.
 */
async function expireSession(stripe: Stripe, sessionId: string) {
  const existing = await stripe.checkout.sessions.retrieve(sessionId)
  if (existing.status === "complete") throw checkoutCompleted()
  if (existing.status !== "open") return
  const expired = await stripe.checkout.sessions.expire(sessionId)
  if (expired.status === "complete") throw checkoutCompleted()
}

/**
 * A Customer Portal session (payment methods, invoices, cancellation as the
 * portal configuration allows) for the organisation's own Stripe customer
 * only. No customer yet: 409 `billing_customer_missing`.
 */
export async function openCustomerPortal(options: {
  tenant: TenantRunner
  organisationId: string
  userId: string
  requestId: string
  stripe?: Stripe
}): Promise<PortalResult> {
  const { tenant, organisationId, userId, requestId } = options
  const ready = await requireBillingReady(false)
  const stripe = options.stripe ?? getStripe()
  const env = getServerEnv()
  return tenant(async (sql) => {
    const view = await getOrganisationBilling(sql, organisationId)
    const customerId = view.billing?.stripeCustomerId
    if (!customerId) {
      throw new ApiError(
        409,
        "billing_customer_missing",
        "Start a subscription before managing billing details."
      )
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${ready.appUrl}${BILLING_RETURN_PATH}`,
      ...(env.STRIPE_PORTAL_CONFIGURATION_ID
        ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID }
        : {}),
    })
    await writeAudit(sql, {
      organisationId,
      actorUserId: userId,
      action: "billing.portal_opened",
      subjectType: "organisation_billing",
      subjectId: organisationId,
      requestId,
    })
    return { url: portal.url }
  })
}

/**
 * Billing actions commit the customer to payments, so a support
 * impersonation session may not take them (as it may not switch
 * organisation or accept invitations).
 */
export function refuseSupportSession(session: {
  supportActor?: string | null
}) {
  if (session.supportActor) {
    throw new ApiError(
      403,
      "support_session_forbidden",
      "A support session cannot change billing."
    )
  }
}
