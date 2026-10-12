import "server-only"

import type { TransactionSql } from "postgres"

import type { Plan } from "@/lib/contracts/billing"
import type { BillingEnvironment } from "@/lib/server/billing/stripe"
import { ApiError } from "@/lib/server/http"

/**
 * The plan catalog (`billing_plan`, migration 0220) as checkout and plan
 * changes see it (plan P07-S5). The server is the allowlist: a client names
 * a plan id, and only an ACTIVE version for the organisation's workspace
 * mode in the deployment's Stripe environment, with a Stripe price, can be
 * bought or scheduled. The price id never leaves the server.
 */

export type CatalogPlan = Plan & { stripePriceId: string | null }

type Row = {
  id: string
  code: string
  version: number
  workspaceMode: "business" | "agency"
  environment: BillingEnvironment
  name: string
  stripePriceId: string | null
  locationLimit: number
  memberLimit: number | null
  aiDraftCreditsPerPeriod: number
  isTestOffer: boolean
  active: boolean
}

const columns = (sql: TransactionSql) => sql`
  id::text as id,
  code,
  version,
  workspace_mode as "workspaceMode",
  environment,
  name,
  stripe_price_id as "stripePriceId",
  location_limit as "locationLimit",
  member_limit as "memberLimit",
  ai_draft_credits_per_period as "aiDraftCreditsPerPeriod",
  is_test_offer as "isTestOffer",
  active
`

/** The customer-facing shape: everything but the Stripe price id. */
export function publicPlan(plan: CatalogPlan): Plan {
  return {
    id: plan.id,
    code: plan.code,
    version: plan.version,
    workspaceMode: plan.workspaceMode,
    environment: plan.environment,
    name: plan.name,
    locationLimit: plan.locationLimit,
    memberLimit: plan.memberLimit,
    aiDraftCreditsPerPeriod: plan.aiDraftCreditsPerPeriod,
    isTestOffer: plan.isTestOffer,
    active: plan.active,
  }
}

/** The plans a customer may choose now, cheapest limit first. */
export async function listCatalog(
  sql: TransactionSql,
  scope: {
    workspaceMode: "business" | "agency"
    environment: BillingEnvironment
  }
): Promise<CatalogPlan[]> {
  return sql<Row[]>`
    select ${columns(sql)}
    from billing_plan
    where active
      and stripe_price_id is not null
      and workspace_mode = ${scope.workspaceMode}
      and environment = ${scope.environment}
    order by location_limit, code, version
  `
}

/** Any plan version by id (current and pending plans may be retired). */
export async function getPlan(
  sql: TransactionSql,
  planId: string | null
): Promise<CatalogPlan | null> {
  if (!planId) return null
  const [row] = await sql<Row[]>`
    select ${columns(sql)} from billing_plan where id = ${planId}
  `
  return row ?? null
}

export function planUnavailable(): ApiError {
  return new ApiError(
    400,
    "plan_unavailable",
    "That plan is not available for this workspace."
  )
}

/**
 * The plan a request named, if the allowlist offers it; 400
 * `plan_unavailable` otherwise (unknown, retired, another environment or
 * workspace mode, or no Stripe price).
 */
export async function requireOfferedPlan(
  sql: TransactionSql,
  planId: string,
  scope: {
    workspaceMode: "business" | "agency"
    environment: BillingEnvironment
  }
): Promise<CatalogPlan & { stripePriceId: string }> {
  const plan = await getPlan(sql, planId)
  if (
    !plan ||
    !plan.active ||
    !plan.stripePriceId ||
    plan.workspaceMode !== scope.workspaceMode ||
    plan.environment !== scope.environment
  ) {
    throw planUnavailable()
  }
  return { ...plan, stripePriceId: plan.stripePriceId }
}
