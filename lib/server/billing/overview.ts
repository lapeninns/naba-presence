import "server-only"

import type { TransactionSql } from "postgres"

import type { BillingOverview } from "@/lib/contracts/billing"
import { SUBSCRIBED_STATES, TRIAL_DAYS } from "@/lib/domain/billing-lifecycle"
import { getPlan, listCatalog, publicPlan } from "@/lib/server/billing/catalog"
import {
  billingReadiness,
  readOpenCheckout,
  workspaceModeOf,
} from "@/lib/server/billing/checkout"
import {
  accessFromView,
  getOrganisationBilling,
} from "@/lib/server/billing/state"
import { getServerEnv } from "@/lib/server/env"
import {
  countBillableLocations,
  enforcementApplies,
} from "@/lib/server/entitlement-policy"
import type { PauseSnapshot } from "@/lib/server/pause-controls"
import type { Session } from "@/lib/server/session"

/**
 * GET /api/billing (plan P07-S5): the organisation's billing record, its
 * derived access, its billable locations and the plans on offer for its
 * workspace mode in this deployment's Stripe environment. Read-only and
 * Stripe-free; any member may read it, only the owner may act on it.
 */
export async function getBillingOverview(
  sql: TransactionSql,
  session: Pick<Session, "organisationId" | "role" | "supportActor">,
  pauses: PauseSnapshot,
  now: Date = new Date()
): Promise<BillingOverview> {
  const organisationId = session.organisationId
  const env = getServerEnv()
  const view = await getOrganisationBilling(sql, organisationId)
  const billing = view.billing
  const environment = env.BILLING_ENVIRONMENT
  const workspaceMode = await workspaceModeOf(sql, organisationId)
  const catalog = await listCatalog(sql, { workspaceMode, environment })
  const [plan, pendingPlan, billableLocations, open, synced] =
    await Promise.all([
      getPlan(sql, billing?.planId ?? null),
      getPlan(sql, billing?.pendingPlanId ?? null),
      countBillableLocations(sql, organisationId),
      readOpenCheckout(sql, organisationId),
      sql<{ providerSyncedAt: Date | null }[]>`
        select provider_synced_at as "providerSyncedAt"
        from organisation_billing
        where organisation_id = ${organisationId}
      `,
    ])
  const readiness = billingReadiness({ env, pauses, forCheckout: true })
  const reason = !readiness.ok
    ? readiness.reason
    : catalog.length === 0
      ? "catalog_empty"
      : null
  const access = accessFromView(view, now)
  return {
    state: billing?.state ?? null,
    environment: billing?.environment ?? null,
    plan: plan ? publicPlan(plan) : null,
    pendingPlan: pendingPlan ? publicPlan(pendingPlan) : null,
    pendingEffectiveAt: billing?.pendingEffectiveAt?.toISOString() ?? null,
    trialEndsAt: billing?.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: billing?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
    hasCustomer: Boolean(billing?.stripeCustomerId),
    providerSyncedAt: synced[0]?.providerSyncedAt?.toISOString() ?? null,
    // The record's half of checkout's first-subscription rule; Stripe's own
    // subscription list (checked at checkout) can still withhold the trial.
    trialDays:
      billing &&
      billing.stripeSubscriptionId === null &&
      !billing.firstPaymentSucceeded
        ? TRIAL_DAYS
        : 0,
    writesBlocked: enforcementApplies(view) && !access.canWrite,
    checkoutPending:
      open &&
      open.expiresAt.getTime() > now.getTime() &&
      !SUBSCRIBED_STATES.includes(billing?.state ?? "read_only")
        ? { planId: open.planId, expiresAt: open.expiresAt.toISOString() }
        : null,
    access: {
      ...access,
      endsAt: access.endsAt?.toISOString() ?? null,
    },
    billableLocations,
    catalog: catalog.map(publicPlan),
    checkout: { available: reason === null, reason },
    canManage: session.role === "owner" && !session.supportActor,
  }
}
