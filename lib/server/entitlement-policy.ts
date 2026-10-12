import "server-only"

import type { TransactionSql } from "postgres"

import type { Access } from "@/lib/domain/entitlements"
import {
  accessFromView,
  getOrganisationBilling,
  type OrganisationBillingView,
} from "@/lib/server/billing/state"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, locationLimitReachedError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

/**
 * Central entitlement enforcement (plan P07-S3). One place decides whether
 * an organisation's billing lets it start new work; lib/domain/entitlements.ts
 * deriveAccess decides what its billing record allows.
 *
 * Enforced only when both switches are on (fails open by rollout, closed by
 * record):
 *   - BILLING_ENFORCEMENT_ENABLED, the env hard override (default off);
 *   - organisation_billing.enforcement_enabled, per organisation (0110,
 *     default off). An organisation with no billing row at all is enforced
 *     whenever the env flag is on: a missing record never grants anything.
 *     The location-limit trigger agrees (0111): with no billing row it
 *     applies a limit of 0 when the app's tenant transaction says
 *     enforcement is on.
 *
 * Where it applies:
 *   - routes: lib/server/route.ts refuses every session mutation (any method
 *     but GET/HEAD/OPTIONS) with 402 `billing_read_only` while the
 *     organisation is read-only, unless the route declares
 *     `entitlement: "exempt"`. AI routes declare `entitlement: "ai"`
 *     (Access.canUseAi). The exempt routes are listed in
 *     ENTITLEMENT_EXEMPT_ROUTES below, and tests/route-entitlements.test.ts
 *     fails when a route and this list disagree;
 *   - the job runner (lib/server/jobs.ts) and the scheduled-post and bulk
 *     listing runners hold new provider dispatch (`organisationWriteBlock`).
 *     Read-backs of uncertain writes (`recover`, `mutation_recover`) and
 *     the read-only syncs keep running;
 *   - the location limit is a database trigger (0110
 *     location_link_enforce_limit), so every writer meets it;
 *     `locationLimitError` maps its error to 402 `location_limit_reached`.
 *
 * Read-only keeps everything that lets a customer leave, comply or come
 * back: sign-in and session switching, billing, data export, privacy
 * requests and legal holds, disconnecting Google and unlinking locations,
 * accepting or revoking invitations, removing members, cancelling or pausing
 * queued work, and their own notification state.
 */

export type RouteEntitlement = "write" | "ai" | "exempt"

/**
 * Session mutations that stay available while read-only, as
 * "METHOD path-under-app/api". Every route here declares
 * `entitlement: "exempt"`, and no other route may.
 */
export const ENTITLEMENT_EXEMPT_ROUTES = [
  // Sign-in and the session itself.
  "POST session/switch",
  "DELETE support/impersonation",
  // Export, privacy and compliance.
  "POST privacy/export",
  "POST privacy/requests",
  "PATCH privacy/requests",
  "POST legal-holds",
  "DELETE legal-holds",
  // Leaving Google.
  "POST google/connections/[id]/disconnect",
  "DELETE location-links",
  // Membership: joining another workspace, withdrawing access.
  "POST invitations/[token]",
  "DELETE invitations/[token]",
  "DELETE members",
  // Cancelling or pausing work already queued (dispatch is held anyway).
  "POST listings/bulk/[id]/cancel",
  "PATCH locations/[id]/post-schedules/[scheduleId]",
  "DELETE sync/backfill",
  // A person's own notification state.
  "POST notifications/read",
  "PUT notifications/preferences",
  "POST notifications/[incidentId]/resolve",
] as const

/**
 * Route directories whose every session mutation must declare
 * `entitlement: "exempt"` (route() cannot see its own path, so the prefix
 * exempts nothing by itself); tests/route-entitlements.test.ts fails on a
 * session mutation under one of them that does not.
 */
export const ENTITLEMENT_EXEMPT_PREFIXES = ["billing/"] as const

/**
 * What happens to each kind of background work while an organisation is
 * read-only and enforcement applies: `held` (new provider dispatch waits,
 * through organisationWriteBlock) or `runs`. Keys are the job kinds
 * claim_due_jobs hands out (lib/server/jobs.ts JOB_KINDS), the runners that
 * share the job tick (its summary keys) and the cron ticks (vercel.json).
 * tests/route-entitlements.test.ts fails when one of them is missing here,
 * so a new kind lands with its decision.
 *
 * Only new writes to Google on someone's behalf are held. Read-backs and
 * read-only syncs keep the record truthful; privacy withdrawals, retention
 * and billing are what lets a customer comply, leave or come back; queued
 * email (invitations, alerts) delivers what was already decided, while a
 * new invitation or a resend is a route ("write") and is refused.
 */
export const READ_ONLY_BACKGROUND_WORK = {
  // Job kinds (claim_due_jobs).
  webhook: "runs",
  webhook_dead: "runs",
  checkpoint: "runs",
  recover: "runs",
  retry: "held",
  reconcile: "runs",
  performance: "runs",
  keywords: "runs",
  mutation_recover: "runs",
  // Runners on the job tick.
  billing: "runs",
  bulk: "held",
  schedules: "held",
  privacy: "runs",
  invitations: "runs",
  // Cron ticks.
  "jobs/run": "runs",
  "sync/reconcile": "runs",
  "sync/presence-resources": "runs",
  "sync/performance": "runs",
  "sync/sweep": "runs",
  "sync/keywords": "runs",
  "cron/retention": "runs",
  "cron/health": "runs",
  "billing/reconcile": "runs",
} as const satisfies Record<string, "held" | "runs">

export const BILLING_READ_ONLY_MESSAGE =
  "This workspace's subscription is read-only, so new changes are unavailable. Billing, exports, privacy requests and disconnecting Google still work."

/** Whether enforcement applies to an organisation with this billing view. */
export function enforcementApplies(
  view: OrganisationBillingView,
  enabled: boolean = getServerEnv().BILLING_ENFORCEMENT_ENABLED
): boolean {
  if (!enabled) return false
  return view.billing === null || view.billing.enforcementEnabled
}

export function billingReadOnlyError(access: Access | undefined): ApiError {
  return new ApiError(402, "billing_read_only", BILLING_READ_ONLY_MESSAGE, {
    details: {
      reason: access?.reason ?? "billing_missing",
      mode: access?.mode ?? "read_only",
    },
  })
}

type EntitlementSession = Pick<Session, "access" | "entitlementEnforced">

/**
 * Whether the session's organisation may make changes now. True whenever
 * enforcement does not apply to it.
 */
export function sessionCanWrite(session: EntitlementSession): boolean {
  if (!session.entitlementEnforced) return true
  return session.access?.canWrite ?? false
}

/** Throws 402 `billing_read_only` when the route's entitlement is not met. */
export function assertRouteEntitled(
  session: EntitlementSession,
  entitlement: RouteEntitlement
): void {
  if (entitlement === "exempt" || !session.entitlementEnforced) return
  const access = session.access
  const allowed =
    access !== undefined &&
    (entitlement === "ai" ? access.canUseAi : access.canWrite)
  if (!allowed) throw billingReadOnlyError(access)
}

/**
 * For workers: the organisation's access when enforcement applies and it
 * may not start new writes, else null. Runs inside the organisation's
 * tenant transaction.
 */
export async function organisationWriteBlock(
  sql: TransactionSql,
  organisationId: string,
  now: Date = new Date()
): Promise<Access | null> {
  const view = await getOrganisationBilling(sql, organisationId)
  if (!enforcementApplies(view)) return null
  const access = accessFromView(view, now)
  return access.canWrite ? null : access
}

/**
 * The seat check the 0110/0111 location_link_enforce_limit trigger makes,
 * for flows that must know before an irreversible provider write (creating
 * a Google location) whether they will be able to link the result. Throws
 * 402 `location_limit_reached` when a new Google location would not fit.
 * The trigger still decides at link time; this only fails early. Runs
 * inside the organisation's tenant transaction (the count is under RLS).
 */
export async function assertNewLocationSeat(
  sql: TransactionSql,
  organisationId: string,
  now: Date = new Date()
): Promise<void> {
  const view = await getOrganisationBilling(sql, organisationId)
  if (!enforcementApplies(view)) return
  // As the trigger: a pilot has no limit; any other state, or no record,
  // takes the lower of the current and scheduled plan's limit (0 without a
  // plan).
  if (view.billing?.state === "pilot") return
  const limit = accessFromView(view, now).newLinkLimit ?? 0
  const count = await countBillableLocations(sql, organisationId)
  if (count >= limit) throw locationLimitReachedError(limit)
}

/**
 * Billable locations: distinct actively linked Google locations, the count
 * the 0110 trigger limits (a link whose connection expired still counts
 * until it is unlinked). Runs inside the organisation's tenant transaction;
 * the count is under RLS, since the runtime may not call the definer
 * billable_location_count (0111).
 */
export async function countBillableLocations(
  sql: TransactionSql,
  organisationId: string
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(distinct external_location_id)::int as n
    from location_link
    where organisation_id = ${organisationId} and is_active
  `
  return row?.n ?? 0
}
