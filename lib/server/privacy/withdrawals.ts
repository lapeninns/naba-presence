import "server-only"

import { writeAudit } from "@/lib/server/audit"
import {
  actorScopeFromMembership,
  recheckAuthorisation,
  type GrantScope,
} from "@/lib/server/authz/actor"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"

import {
  PRIVACY_WITHDRAWAL_MAX_ATTEMPTS,
  recordWithdrawalExhausted,
  settleWithdrawal,
  withdrawReplies,
  type WithdrawalSettlement,
} from "./fulfil"

/**
 * The background half of a parked erasure (plan P04-5).
 *
 * The job tick (lib/server/jobs.ts runDueJobs) claims `in_progress` privacy
 * requests whose `next_attempt_at` is due (claim_due_privacy_withdrawals,
 * 0101) and runs one withdrawal round for each, as the owner whose fulfil
 * parked it. There is no Session here: the owner's grant is re-derived from
 * membership at dispatch (lib/server/authz/actor.ts), so an owner who has
 * since been removed or demoted stops the retries (`actor_revoked`) instead
 * of withdrawing under a role they no longer hold. Another owner re-fulfilling
 * the request takes it over.
 *
 * What it is NOT held by: the organisation's entitlement (a read-only
 * organisation must still be able to honour an erasure) and the scopes of
 * unrelated work. The reply delete itself still honours the publish control,
 * which defers the round at no cost to its retry budget.
 */

/** Refusals that need a human: the tick will not retry them on its own. */
export type WithdrawalHold = "actor_revoked" | "privacy_legal_hold"

export type PrivacyWithdrawalTickSummary = {
  claimed: number
  completed: number
  retrying: number
  deferred: number
  exhausted: number
  held: number
  failed: number
  /** Claimed but not started before the deadline; lease released. */
  released: number
}

type Prepared =
  | { kind: "skip" }
  | { kind: "held"; code: WithdrawalHold }
  | {
      kind: "run"
      actorUserId: string
      scope: GrantScope
      reviewIds: string[]
    }

/** Stop retrying and record why; a human has to act before it can finish. */
async function holdForHuman(
  organisationId: string,
  privacyRequestId: string,
  code: WithdrawalHold,
  details: { actorUserId: string | null; requestId: string; reason?: string }
) {
  await withTenant(organisationId, async (sql) => {
    await sql`
      update privacy_request
      set
        next_attempt_at = null,
        last_error_code = ${code},
        withdrawal_lease_expires_at = null
      where id = ${privacyRequestId}
        and status = 'in_progress'
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: details.actorUserId,
      action: "privacy.request.withdrawal_held",
      subjectType: "privacy_request",
      subjectId: privacyRequestId,
      requestId: details.requestId,
      metadata: { code, reason: details.reason ?? null },
    })
  })
}

/**
 * Re-read the claimed request and decide, under its row lock, whether this
 * round may run and as whom.
 */
async function prepare(
  organisationId: string,
  privacyRequestId: string,
  requestId: string
): Promise<Prepared> {
  const decision = await withTenant(organisationId, async (sql) => {
    const [row] = await sql<
      {
        status: string
        pendingReviewIds: string[]
        actorUserId: string | null
      }[]
    >`
      select
        status,
        pending_review_ids::text[] as "pendingReviewIds",
        withdrawal_actor_id::text as "actorUserId"
      from privacy_request
      where id = ${privacyRequestId}
      for update
    `
    if (!row || row.status !== "in_progress") return { kind: "skip" as const }
    if (row.pendingReviewIds.length === 0) {
      // Parked by a manual status move with nothing to withdraw: there is no
      // round to run, so stop claiming it.
      await sql`
        update privacy_request
        set next_attempt_at = null, withdrawal_lease_expires_at = null
        where id = ${privacyRequestId}
      `
      return { kind: "skip" as const }
    }
    const holds = await sql`
      select 1
      from legal_hold
      where review_id = any(${row.pendingReviewIds}::uuid[])
        and released_at is null
      limit 1
    `
    if (holds.length) {
      return {
        kind: "held" as const,
        code: "privacy_legal_hold" as const,
        actorUserId: row.actorUserId,
      }
    }
    if (!row.actorUserId) {
      return {
        kind: "held" as const,
        code: "actor_revoked" as const,
        actorUserId: null,
        reason: "actor_missing",
      }
    }
    // Fulfilling an erasure is owner-only (the PATCH declares roles:
    // ["owner"]), so the background round demands the same of its actor.
    const scope = await actorScopeFromMembership(
      sql,
      organisationId,
      row.actorUserId
    )
    if (!scope || scope.role !== "owner") {
      return {
        kind: "held" as const,
        code: "actor_revoked" as const,
        actorUserId: row.actorUserId,
        reason: scope ? "role_changed" : "actor_not_member",
      }
    }
    const locations = await sql<{ locationId: string }[]>`
      select distinct location_id::text as "locationId"
      from review
      where id = any(${row.pendingReviewIds}::uuid[])
    `
    for (const { locationId } of locations) {
      const recheck = await recheckAuthorisation(sql, {
        organisationId,
        actorUserId: row.actorUserId,
        locationId,
        action: "publish",
      })
      if (!recheck.ok) {
        return {
          kind: "held" as const,
          code: "actor_revoked" as const,
          actorUserId: row.actorUserId,
          reason: recheck.reason,
        }
      }
    }
    return {
      kind: "run" as const,
      actorUserId: row.actorUserId,
      scope,
      reviewIds: row.pendingReviewIds,
    }
  })
  if (decision.kind === "held") {
    await holdForHuman(organisationId, privacyRequestId, decision.code, {
      actorUserId: decision.actorUserId,
      requestId,
      reason: "reason" in decision ? decision.reason : undefined,
    })
    return { kind: "held", code: decision.code }
  }
  return decision
}

/** One background withdrawal round for one claimed request. */
export async function processPrivacyWithdrawal(input: {
  organisationId: string
  privacyRequestId: string
  requestId: string
  /** Epoch ms the round must finish its provider calls by. */
  deadline?: number
}): Promise<Prepared["kind"] | WithdrawalSettlement["outcome"]> {
  const prepared = await prepare(
    input.organisationId,
    input.privacyRequestId,
    input.requestId
  )
  if (prepared.kind !== "run") return prepared.kind
  const removal = await withdrawReplies({
    organisationId: input.organisationId,
    actor: prepared.scope,
    requestId: input.requestId,
    reviewIds: prepared.reviewIds,
    deadline: input.deadline,
  })
  const settlement = await settleWithdrawal({
    organisationId: input.organisationId,
    privacyRequestId: input.privacyRequestId,
    actorUserId: prepared.actorUserId,
    requestId: input.requestId,
    source: "background",
    reviewIds: prepared.reviewIds,
    removal,
  })
  return settlement.outcome
}

/**
 * Release the lease after a round that threw, so the request is claimable
 * again at its next attempt time rather than only after the lease runs out,
 * and count the round against the budget: an error that repeats must not
 * retry forever. A round that spends the last attempt leaves the same
 * exhaustion trail as one that settled.
 */
async function recordRoundError(
  organisationId: string,
  privacyRequestId: string,
  requestId: string
) {
  await withTenant(organisationId, async (sql) => {
    const [row] = await sql<
      { attempts: number; exhausted: boolean; actorUserId: string | null }[]
    >`
      update privacy_request
      set
        withdrawal_attempts = withdrawal_attempts + 1,
        next_attempt_at = case
          when withdrawal_attempts + 1 >= ${PRIVACY_WITHDRAWAL_MAX_ATTEMPTS}
            then null
          else now() + interval '15 minutes'
        end,
        last_error_code = 'withdrawal_round_failed',
        withdrawal_lease_expires_at = null
      where id = ${privacyRequestId}
        and status = 'in_progress'
      returning
        withdrawal_attempts as attempts,
        next_attempt_at is null as exhausted,
        withdrawal_actor_id::text as "actorUserId"
    `
    if (row?.exhausted) {
      await recordWithdrawalExhausted(sql, {
        organisationId,
        privacyRequestId,
        actorUserId: row.actorUserId,
        requestId,
        attempts: row.attempts,
        lastErrorCode: "withdrawal_round_failed",
        pending: null,
      })
    }
  })
}

/**
 * Hand back requests this tick claimed but has no time left to start. The
 * claim cost them nothing, so they keep their schedule and budget and are
 * claimable on the next tick instead of after the lease runs out.
 */
async function releaseUnstarted(
  rows: readonly { organisationId: string; privacyRequestId: string }[]
) {
  const byOrganisation = new Map<string, string[]>()
  for (const row of rows) {
    const ids = byOrganisation.get(row.organisationId) ?? []
    ids.push(row.privacyRequestId)
    byOrganisation.set(row.organisationId, ids)
  }
  for (const [organisationId, ids] of byOrganisation) {
    await withTenant(organisationId, async (sql) => {
      await sql`
        update privacy_request
        set withdrawal_lease_expires_at = null
        where id = any(${ids}::uuid[])
          and status = 'in_progress'
      `
    }).catch((error: unknown) => {
      // The lease still runs out on its own; this only makes it sooner.
      log.warn("privacy.withdrawal_lease_release_failed", {
        organisationId,
        error,
      })
    })
  }
}

/** Called from the job tick while its budget lasts. */
export async function runDuePrivacyWithdrawals(options: {
  budgetMs: number
  requestId: string
}): Promise<PrivacyWithdrawalTickSummary> {
  const summary: PrivacyWithdrawalTickSummary = {
    claimed: 0,
    completed: 0,
    retrying: 0,
    deferred: 0,
    exhausted: 0,
    held: 0,
    failed: 0,
    released: 0,
  }
  const env = getServerEnv()
  const deadline = Date.now() + options.budgetMs
  const leaseSeconds = Math.ceil(options.budgetMs / 1000) + 60
  // A round starts only with one provider call's worth of time left, and
  // withdrawReplies stops before any further call that would not fit: the
  // tick must answer inside the route's maxDuration, and a round killed
  // mid-flight never settles or spends its budget.
  const hasTime = () => Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline
  claiming: while (hasTime()) {
    const claimed = await getDatabase()<
      { organisationId: string; privacyRequestId: string }[]
    >`
      select
        organisation_id::text as "organisationId",
        privacy_request_id::text as "privacyRequestId"
      from claim_due_privacy_withdrawals(
        ${env.JOBS_BATCH_SIZE},
        ${leaseSeconds},
        ${env.JOBS_PER_ORGANISATION}
      )
    `
    if (!claimed.length) break
    summary.claimed += claimed.length
    for (const [index, row] of claimed.entries()) {
      if (!hasTime()) {
        const unstarted = claimed.slice(index)
        summary.released += unstarted.length
        await releaseUnstarted(unstarted)
        break claiming
      }
      try {
        const outcome = await processPrivacyWithdrawal({
          organisationId: row.organisationId,
          privacyRequestId: row.privacyRequestId,
          requestId: options.requestId,
          deadline,
        })
        if (outcome === "completed") summary.completed += 1
        else if (outcome === "retry_scheduled") summary.retrying += 1
        else if (outcome === "deferred") summary.deferred += 1
        else if (outcome === "exhausted") summary.exhausted += 1
        else if (outcome === "held") summary.held += 1
      } catch (error) {
        summary.failed += 1
        log.error("privacy.withdrawal_round_failed", {
          organisationId: row.organisationId,
          privacyRequestId: row.privacyRequestId,
          error,
        })
        await recordRoundError(
          row.organisationId,
          row.privacyRequestId,
          options.requestId
        ).catch(() => undefined)
      }
    }
  }
  return summary
}
