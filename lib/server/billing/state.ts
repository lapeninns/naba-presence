import "server-only"

import type { TransactionSql } from "postgres"

import {
  deriveAccess,
  type Access,
  type BillingRecord,
  type BillingState,
  type PlanLimits,
} from "@/lib/domain/entitlements"

/**
 * Reads of `organisation_billing` and its plans (migration 0220). Every
 * function runs inside the organisation's tenant transaction (withTenant);
 * the explicit organisation filter keeps each query correct outside it too.
 */

export type OrganisationBilling = BillingRecord & {
  organisationId: string
  planId: string | null
  pendingPlanId: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  environment: "test" | "live" | null
  /** Per-organisation enforcement rollout flag (0223). */
  enforcementEnabled: boolean
  version: number
}

export type OrganisationBillingView = {
  /** null: the organisation has no billing row (derives read-only). */
  billing: OrganisationBilling | null
  plan: PlanLimits | null
  pendingPlan: PlanLimits | null
}

type Row = {
  organisationId: string
  state: BillingState
  planId: string | null
  pendingPlanId: string | null
  pendingEffectiveAt: Date | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  environment: "test" | "live" | null
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  graceEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  firstPaymentSucceeded: boolean
  enforcementEnabled: boolean
  version: number
  planLocationLimit: number | null
  planMemberLimit: number | null
  pendingLocationLimit: number | null
  pendingMemberLimit: number | null
}

function toView(row: Row | undefined): OrganisationBillingView {
  if (!row) return { billing: null, plan: null, pendingPlan: null }
  const {
    planLocationLimit,
    planMemberLimit,
    pendingLocationLimit,
    pendingMemberLimit,
    ...billing
  } = row
  return {
    billing,
    plan:
      planLocationLimit === null
        ? null
        : { locationLimit: planLocationLimit, memberLimit: planMemberLimit },
    pendingPlan:
      pendingLocationLimit === null
        ? null
        : {
            locationLimit: pendingLocationLimit,
            memberLimit: pendingMemberLimit,
          },
  }
}

async function readBilling(
  sql: TransactionSql,
  organisationId: string,
  lock: boolean
): Promise<OrganisationBillingView> {
  if (lock) {
    await sql`
      select 1
      from organisation_billing
      where organisation_id = ${organisationId}
      for update
    `
  }
  const [row] = await sql<Row[]>`
    select
      b.organisation_id::text as "organisationId",
      b.state,
      b.plan_id::text as "planId",
      b.pending_plan_id::text as "pendingPlanId",
      b.pending_effective_at as "pendingEffectiveAt",
      b.stripe_customer_id as "stripeCustomerId",
      b.stripe_subscription_id as "stripeSubscriptionId",
      b.environment,
      b.trial_ends_at as "trialEndsAt",
      b.current_period_start as "currentPeriodStart",
      b.current_period_end as "currentPeriodEnd",
      b.grace_ends_at as "graceEndsAt",
      b.cancel_at_period_end as "cancelAtPeriodEnd",
      b.first_payment_succeeded as "firstPaymentSucceeded",
      b.enforcement_enabled as "enforcementEnabled",
      b.version,
      p.location_limit as "planLocationLimit",
      p.member_limit as "planMemberLimit",
      pp.location_limit as "pendingLocationLimit",
      pp.member_limit as "pendingMemberLimit"
    from organisation_billing b
    left join billing_plan p on p.id = b.plan_id
    left join billing_plan pp on pp.id = b.pending_plan_id
    where b.organisation_id = ${organisationId}
  `
  return toView(row)
}

/** The organisation's billing record and plan limits, unlocked. */
export function getOrganisationBilling(
  sql: TransactionSql,
  organisationId: string
): Promise<OrganisationBillingView> {
  return readBilling(sql, organisationId, false)
}

/**
 * The same read holding the row lock until the transaction ends, so billing
 * writers for one organisation serialise (like ai-credits readUsage on the
 * organisation row; DATABASE_URL is the transaction pooler, so a session
 * advisory lock is not an option). No row means nothing is locked.
 */
export function lockOrganisationBilling(
  sql: TransactionSql,
  organisationId: string
): Promise<OrganisationBillingView> {
  return readBilling(sql, organisationId, true)
}

/** The organisation's access at `now` (read-only without a billing row). */
export async function getOrganisationAccess(
  sql: TransactionSql,
  organisationId: string,
  now: Date = new Date()
): Promise<Access> {
  const view = await getOrganisationBilling(sql, organisationId)
  return accessFromView(view, now)
}

export function accessFromView(
  view: OrganisationBillingView,
  now: Date
): Access {
  return deriveAccess(
    view.billing,
    { current: view.plan, pending: view.pendingPlan },
    now
  )
}

/**
 * Gives a new organisation its explicit pilot record. Called in the same
 * transaction that inserts the organisation, under its tenant context.
 * Idempotent: an existing record is left as it is. Since 0222 the
 * organisation insert trigger seeds the same row first, so on a migrated
 * database this is a belt-and-braces no-op.
 */
export async function seedPilotBilling(
  sql: TransactionSql,
  organisationId: string
): Promise<void> {
  await sql`
    insert into organisation_billing (organisation_id, state)
    values (${organisationId}, 'pilot')
    on conflict (organisation_id) do nothing
  `
}
