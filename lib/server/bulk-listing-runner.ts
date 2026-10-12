import "server-only"

import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import {
  BULK_MAX_RUNNING_PER_ORGANISATION,
  bulkOperationInputSchema,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { writeAudit } from "@/lib/server/audit"
import {
  recheckApprovedWork,
  type ApprovedWorkResult,
} from "@/lib/server/authz/approval-policy"
import {
  bulkApprovalRef,
  bulkFamily,
  bulkIntentId,
  receiptFor,
  type DispatchOutcome,
} from "@/lib/server/bulk-families"
import {
  getDatabase,
  jsonColumn,
  withSessionConnection,
  withTenant,
} from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { resolveGbpLocationContext } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import {
  requireNoUnresolvedAccountChange,
  withGoogleAccountChangeLock,
} from "@/lib/server/google-account-change-lock"
import { log } from "@/lib/server/logger"
import { recordOperationalEvent } from "@/lib/server/notifications/operational"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { gbpWriteScopes, isScopeEnabled } from "@/lib/server/pause-controls"
import type { Session } from "@/lib/server/session"

type Child = {
  id: string
  operationId: string
  locationId: string
  updateMask: string[]
  baselineHash: string | null
  current: unknown
  proposed: unknown
  input: unknown
  approvedBy: string | null
  requestedBy: string
  requireTwoPersonApproval: boolean
  operationStatus: string
  executeRequestedAt: Date | null
  dispatchExpiresAt: Date | null
  resourceKey: string
  connectionId: string | null
  credentialGeneration: number | null
  googleLocationName: string | null
  authorisedSecurityVersion: number | null
  attempts: number
}
export type BulkTickSummary = {
  children: number
  succeeded: number
  failed: number
  conflict: number
  ambiguous: number
  deferred: number
  expired: number
  /** Unresolved children settled from their receipt, never re-sent. */
  reconciled: number
}

async function settle(
  organisationId: string,
  childId: string,
  status:
    "succeeded" | "failed" | "conflict" | "ambiguous" | "queued" | "expired",
  fields: {
    code?: string | null
    confirmation?: "confirmed" | "unresolved" | "unrecorded"
    observed?: unknown
    /**
     * The receipt this claim's write went out under, when it got that far.
     * The claim cleared the previous claim's (0262), so this is only ever
     * the latest send's receipt.
     */
    operationId?: string | null
  } = {}
) {
  await withTenant(
    organisationId,
    (sql) => sql`
    update bulk_listing_child set status = ${status}, result_code = ${fields.code ?? null},
      confirmation_state = ${fields.confirmation ?? "unrecorded"}, lease_expires_at = null,
      finished_at = ${status === "queued" ? null : sql`now()`},
      next_attempt_at = ${status === "queued" ? sql`now() + interval '1 minute'` : null},
      current_value = case when ${fields.observed !== undefined} then ${fields.observed === undefined ? null : jsonColumn(sql, fields.observed)} else current_value end,
      mutation_operation_id = ${fields.operationId ?? null}::uuid
    where id = ${childId} and status = 'running'`
  )
}

/**
 * The code a refused child settles with. The UI already explains these
 * (components/bulk/bulk-operation-view.tsx): a person's lost right is
 * `permission_revoked`, a moved Google target is `google_target_changed`.
 */
function recheckCode(
  refusal: Extract<ApprovedWorkResult, { ok: false }>
): string {
  switch (refusal.reason) {
    case "approval_policy_changed":
    case "second_approver_required":
    case "security_version_unverifiable":
    case "entitlement_unverifiable":
      return refusal.reason
    case "connection_changed":
    case "generation_changed":
      return "google_target_changed"
    case "policy_changed":
      return "approval_policy_changed"
    default:
      return "permission_revoked"
  }
}

/** One claimed child: at most one provider write, then independent readback. */
export async function processBulkChild(
  organisationId: string,
  childId: string,
  requestId: string,
  summary?: BulkTickSummary
) {
  const child = await withTenant(organisationId, async (sql) => {
    const [row] = await sql<Child[]>`
      select c.id::text as id, c.operation_id::text as "operationId", c.location_id::text as "locationId", c.update_mask as "updateMask",
        c.baseline_hash as "baselineHash", c.current_value as current, c.proposed_value as proposed, c.input, o.approved_by::text as "approvedBy",
        o.requested_by::text as "requestedBy", o.require_two_person_approval as "requireTwoPersonApproval", o.status as "operationStatus",
        o.execute_requested_at as "executeRequestedAt", o.dispatch_expires_at as "dispatchExpiresAt", c.resource_key as "resourceKey",
        c.connection_id::text as "connectionId", c.credential_generation as "credentialGeneration", c.google_location_name as "googleLocationName",
        o.authorised_security_version as "authorisedSecurityVersion", c.attempts
      from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id where c.id = ${childId}`
    return row
  })
  if (!child) return
  // The child's own change from the batch's ordered list (0263); the claim
  // only hands it over once the earlier changes at its listing settled.
  const input = bulkOperationInputSchema.parse(child.input)
  const family = bulkFamily(input.operation)
  const fail = async (code: string) => {
    await settle(organisationId, childId, "failed", { code })
    if (summary) summary.failed += 1
  }
  const defer = async (code: string) => {
    await settle(organisationId, childId, "queued", { code })
    if (summary) summary.deferred += 1
  }
  // Dispatch closes 24 hours after approval, for every child: one that is
  // still unsent then is never sent.
  const dispatchClosed = () =>
    !child.dispatchExpiresAt || child.dispatchExpiresAt.getTime() <= Date.now()
  const expire = async () => {
    await settle(organisationId, childId, "expired", {
      code: "dispatch_expired",
    })
    if (summary) summary.expired += 1
  }
  if (dispatchClosed()) return expire()
  // Deferred execution rechecks: the org feature, the approval, both
  // people's current grants for this listing, the policy, the frozen Google
  // target and the provider kill switch.
  const gate = await withTenant(organisationId, async (sql) => {
    // The claim already skips organisations without the feature; this
    // closes the race with an operator switching it off mid-tick.
    if (!(await isOrgFeatureEnabled(sql, organisationId, "bulk_actions")))
      return { defer: "feature_disabled" }
    if (child.operationStatus !== "running" || !child.approvedBy)
      return { code: "approval_invalid" }
    if (!child.executeRequestedAt) return { code: "approval_expired" }
    // The requester may still ask for this change at the listing, the
    // approver may still publish it there as an owner or admin, the frozen
    // two-person flag still holds with two different people, and the
    // listing is still linked through the frozen connection and credential
    // generation (lib/server/authz/approval-policy.ts).
    const recheck = await recheckApprovedWork(sql, {
      organisationId,
      locationId: child.locationId,
      requestedBy: child.requestedBy,
      approvedBy: child.approvedBy,
      requireTwoPersonApproval: child.requireTwoPersonApproval,
      connectionId: child.connectionId,
      generation: child.credentialGeneration,
      approverSecurityVersion: child.authorisedSecurityVersion,
    })
    if (!recheck.ok) return { code: recheckCode(recheck) }
    const [approver] = await sql<
      {
        email: string
        displayName: string
        workspaceMode: Session["workspaceMode"]
      }[]
    >`
      select u.email, coalesce(u.display_name, '') as "displayName", o.workspace_mode as "workspaceMode"
      from app_user u cross join organisation o where u.id = ${child.approvedBy} and o.id = ${organisationId}`
    if (!approver) return { code: "permission_revoked" }
    const session: Session = {
      sessionId: `bulk:${child.operationId}`,
      userId: child.approvedBy,
      organisationId,
      organisationName: "",
      displayName: approver.displayName,
      email: approver.email,
      role: recheck.approver.role,
      canPublish: recheck.approver.canPublish,
      workspaceMode: approver.workspaceMode,
    }
    let linked: Awaited<ReturnType<typeof resolveGbpLocationContext>>
    try {
      linked = await resolveGbpLocationContext(sql, session, child.locationId)
    } catch (error) {
      return {
        code: error instanceof ApiError ? error.code : "connection_unavailable",
      }
    }
    // The recheck proved the connection and generation; the Google
    // location behind the link must be the one previewed too.
    if (
      child.connectionId !== linked.connectionId ||
      child.googleLocationName !== linked.googleLocationName
    )
      return { code: "google_target_changed" }
    // INTEGRATION: deriveAccess (stream B, lib/domain/entitlements.ts) gates
    // new bulk dispatch for a read-only subscription here.
    return { session, linked }
  })
  if ("defer" in gate) return defer(gate.defer ?? "feature_disabled")
  if ("code" in gate) return fail(gate.code ?? "approval_invalid")
  // The surface's own switch, under the env and the operator pause table;
  // the tick already checked `publish` and `bulk`.
  if (!(await isScopeEnabled(gbpWriteScopes(family.writeSurface)))) {
    await settle(organisationId, childId, "queued", {
      code: "publishing_paused",
    })
    if (summary) summary.deferred += 1
    return
  }
  // The receipt intent for this claim (`attempts` counts claims).
  const intentId = bulkIntentId(childId, child.attempts)
  type Outcome = "succeeded" | "conflict" | "ambiguous" | "deferred" | "expired"
  /**
   * Settles the child from its family's dispatch, recording the receipt the
   * write went out under (GET /api/mutations/{id} and `mutation_recover`
   * answer for it from then on).
   */
  const record = async (
    result: DispatchOutcome
  ): Promise<Outcome | { failed: string }> => {
    const receipt = await receiptFor(organisationId, intentId)
    const operationId = receipt?.id ?? null
    switch (result.kind) {
      case "succeeded":
        await settle(organisationId, childId, "succeeded", {
          confirmation: result.confirmation,
          observed: result.observed,
          operationId,
        })
        return "succeeded"
      case "conflict":
        await settle(organisationId, childId, "conflict", {
          code: result.code,
          observed: result.observed,
          operationId,
        })
        return "conflict"
      case "expired":
        await settle(organisationId, childId, "expired", {
          code: "dispatch_expired",
          operationId,
        })
        return "expired"
      case "deferred":
        await settle(organisationId, childId, "queued", {
          code: result.code,
          operationId,
        })
        return "deferred"
      case "ambiguous":
        await settle(organisationId, childId, "ambiguous", {
          code: result.code,
          confirmation: "unresolved",
          observed: result.observed,
          operationId,
        })
        return "ambiguous"
      case "failed":
        await settle(organisationId, childId, "failed", {
          code: result.code,
          operationId,
        })
        return { failed: result.code }
    }
  }
  // The family's baseline read, comparison, window check, one write through
  // the surface pipeline and its readback, all inside the resource lock: an
  // editor write cannot land between the baseline read and the provider
  // call. Action links do this inside the Google account lock too, after
  // the same unresolved-outcome guard reviewed Place Actions, access and
  // lifecycle changes use.
  const dispatch = async (): Promise<Outcome | { failed: string }> => {
    if (family.accountLock)
      await requireNoUnresolvedAccountChange(
        gate.session,
        gate.linked.googleAccountId
      )
    if (dispatchClosed()) return record({ kind: "expired" })
    return record(
      await family.dispatch({
        organisationId,
        operationId: child.operationId,
        childId,
        locationId: child.locationId,
        input,
        session: gate.session,
        linked: gate.linked,
        current: child.current,
        proposed: child.proposed,
        updateMask: child.updateMask,
        baselineHash: child.baselineHash,
        intentId,
        approvalRef: bulkApprovalRef(child.operationId),
        requestId,
        stillOpen: () => !dispatchClosed(),
      })
    )
  }
  // The same per-location lock the single-listing editors take for this
  // resource (`<org>:<location>:attributes` in business-information.ts,
  // `<org>:<location>:hours` in hours.ts `publishCanonicalHours`), so a
  // bulk child never interleaves with an editor write or another batch. Held
  // from the baseline read through the readback; a busy resource defers.
  const withResourceLock = (
    work: () => Promise<Outcome | { failed: string }>
  ) =>
    withSessionConnection((connection) =>
      connection.begin(async (lock): Promise<Outcome | { failed: string }> => {
        const [claim] = await lock<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtextextended(${`${organisationId}:${child.locationId}:${family.resourceKey}`}, 0)) as acquired`
        if (!claim?.acquired) {
          await settle(organisationId, childId, "queued", {
            code: "resource_busy",
          })
          return "deferred"
        }
        return work()
      })
    )
  let outcome: Outcome | { failed: string }
  try {
    outcome = await withResourceLock(() =>
      family.accountLock
        ? withGoogleAccountChangeLock(gate.session, child.locationId, dispatch)
        : dispatch()
    )
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "administration_in_progress"
    ) {
      await settle(organisationId, childId, "queued", { code: error.code })
      outcome = "deferred"
    } else {
      // A write that recorded a receipt may have reached Google: the child
      // waits for that receipt (reconciled once recovery settles it).
      const receipt = await receiptFor(organisationId, intentId)
      if (receipt) {
        await settle(organisationId, childId, "ambiguous", {
          code: "execution_interrupted",
          confirmation: "unresolved",
          operationId: receipt.id,
        })
        outcome = "ambiguous"
      } else
        outcome = {
          failed:
            error instanceof ApiError
              ? error.code
              : "google_confirmation_unresolved",
        }
    }
  }
  if (typeof outcome === "object") return fail(outcome.failed)
  if (summary) summary[outcome] += 1
}

/**
 * Settles children left `ambiguous` whose receipt has since been resolved
 * (by `mutation_recover` reading Google back, or another request settling
 * the same attempt), through their family's reconcile. Nothing is sent: an
 * unresolved write is never retried by the runner. A batch that already
 * finished is re-finished with the new count.
 */
async function reconcileResolvedChildren(
  requestId: string,
  summary: BulkTickSummary,
  limit: number
) {
  const due = await getDatabase()<
    { organisationId: string; childId: string }[]
  >`
    select organisation_id::text as "organisationId", child_id::text as "childId"
    from bulk_children_to_reconcile(${limit})`
  const operations = new Map<string, string>()
  for (const row of due) {
    const settled = await withTenant(row.organisationId, async (sql) => {
      const [child] = await sql<
        {
          operationId: string
          locationId: string
          operation: BulkOperationInput["operation"]
          state: OperationOutcome
          errorCode: string | null
          attemptStatus: string | null
        }[]
      >`
        select c.operation_id::text as "operationId", c.location_id::text as "locationId", c.input->>'operation' as operation,
          m.state, m.error_code as "errorCode", m.receipt->>'attemptStatus' as "attemptStatus"
        from bulk_listing_child c
        join mutation_operation m on m.organisation_id = c.organisation_id and m.id = c.mutation_operation_id
        where c.id = ${row.childId} and c.status = 'ambiguous'
        for update of c`
      if (!child) return null
      const family = bulkFamily(child.operation)
      const verdict = family.reconcile({
        state: child.state,
        errorCode: child.errorCode,
        attemptStatus: child.attemptStatus,
      })
      if (!verdict) return null
      // A write that did not apply leaves nothing behind locally either
      // (an hours child puts back the schedule it saved).
      const undone =
        verdict.kind === "failed" && family.undoNotApplied
          ? await family.undoNotApplied(sql, {
              organisationId: row.organisationId,
              childId: row.childId,
              locationId: child.locationId,
            })
          : {}
      await sql`
        update bulk_listing_child set
          status = ${verdict.kind},
          result_code = ${verdict.kind === "failed" ? verdict.code : null},
          confirmation_state = ${verdict.kind === "succeeded" ? verdict.confirmation : "unrecorded"},
          hours_restore = null,
          finished_at = now()
        where id = ${row.childId}`
      await writeAudit(sql, {
        organisationId: row.organisationId,
        actorUserId: null,
        action: "bulk_listing.child_reconciled",
        subjectType: "bulk_listing_child",
        subjectId: row.childId,
        requestId,
        metadata: {
          operationId: child.operationId,
          outcome: verdict.kind,
          receiptState: child.state,
          ...undone,
        },
      })
      return child.operationId
    })
    if (!settled) continue
    summary.reconciled += 1
    operations.set(settled, row.organisationId)
  }
  for (const [operationId, organisationId] of operations)
    await finishOperation(organisationId, operationId, requestId, {
      refinish: true,
    })
}

/** Completes an operation whose children are all settled, and reports failures once. */
async function finishOperation(
  organisationId: string,
  operationId: string,
  requestId: string,
  options: { refinish?: boolean } = {}
) {
  await withTenant(organisationId, async (sql) => {
    const [op] = await sql<
      { status: string; approvedBy: string }[]
    >`select status, approved_by::text as "approvedBy" from bulk_listing_operation where id = ${operationId} for update`
    // A reconciled child can turn a finished batch's failures into
    // successes; a cancelled or expired batch keeps its status.
    const finished = ["completed", "completed_with_failures"].includes(
      op?.status ?? ""
    )
    if (!op || !(op.status === "running" || (options.refinish && finished)))
      return
    const counts = Object.fromEntries(
      (
        await sql<{ status: string; count: number }[]>`
      select status, count(*)::int as count from bulk_listing_child where operation_id = ${operationId} group by status`
      ).map((row) => [row.status, row.count])
    )
    if ((counts.queued ?? 0) + (counts.running ?? 0) > 0) return
    const failed =
      (counts.failed ?? 0) +
      (counts.conflict ?? 0) +
      (counts.ambiguous ?? 0) +
      (counts.expired ?? 0)
    const status = failed ? "completed_with_failures" : "completed"
    if (finished && op.status === status) return
    await sql`update bulk_listing_operation set status = ${status}, finished_at = now(), updated_at = now() where id = ${operationId}`
    await writeAudit(sql, {
      organisationId,
      actorUserId: op.approvedBy,
      action: failed
        ? "bulk_listing.completed_with_failures"
        : "bulk_listing.completed",
      subjectType: "bulk_listing_operation",
      subjectId: operationId,
      requestId,
      metadata: counts,
    })
    if (failed && !finished) {
      await recordOperationalEvent(sql, {
        version: 1,
        kind: "bulk_completed_with_failures",
        organisationId,
        occurredAt: new Date().toISOString(),
        target: { type: "organisation" },
        source: { type: "bulk", id: operationId },
        succeeded: counts.succeeded ?? 0,
        failed,
        skipped: counts.skipped ?? 0,
      })
    }
  })
}

/**
 * A claim that threw past its own handling: the child is unresolved, and
 * points at this claim's receipt when the write got that far, so it settles
 * from what this send did rather than from nothing.
 */
async function interrupted(organisationId: string, childId: string) {
  const [child] = await withTenant(
    organisationId,
    (sql) => sql<{ attempts: number }[]>`
      select attempts from bulk_listing_child where id = ${childId}`
  )
  const receipt = child
    ? await receiptFor(organisationId, bulkIntentId(childId, child.attempts))
    : null
  await settle(organisationId, childId, "ambiguous", {
    code: "execution_interrupted",
    confirmation: "unresolved",
    operationId: receipt?.id ?? null,
  })
}

/** Called from the job runner tick while its budget lasts. */
export async function runDueBulkChildren(options: {
  budgetMs: number
  requestId: string
}): Promise<BulkTickSummary> {
  const summary: BulkTickSummary = {
    children: 0,
    succeeded: 0,
    failed: 0,
    conflict: 0,
    ambiguous: 0,
    deferred: 0,
    expired: 0,
    reconciled: 0,
  }
  const env = getServerEnv(),
    deadline = Date.now() + options.budgetMs
  while (Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline) {
    const claimed = await getDatabase()<
      { organisationId: string; childId: string }[]
    >`
      select organisation_id::text as "organisationId", child_id::text as "childId"
      from claim_due_bulk_children(${env.JOBS_BATCH_SIZE}, ${Math.ceil(options.budgetMs / 1000) + 60}, ${Math.min(env.JOBS_PER_ORGANISATION, BULK_MAX_RUNNING_PER_ORGANISATION)})`
    if (!claimed.length) break
    const operations = new Map<string, string>()
    await Promise.all(
      claimed.map(async (row) => {
        summary.children += 1
        try {
          await processBulkChild(
            row.organisationId,
            row.childId,
            options.requestId,
            summary
          )
        } catch (error) {
          log.error("bulk_listing.child_failed", {
            organisationId: row.organisationId,
            childId: row.childId,
            error,
          })
          await interrupted(row.organisationId, row.childId).catch(
            () => undefined
          )
        }
        const [owner] = await withTenant(
          row.organisationId,
          (sql) =>
            sql<
              { operationId: string }[]
            >`select operation_id::text as "operationId" from bulk_listing_child where id = ${row.childId}`
        )
        if (owner) operations.set(owner.operationId, row.organisationId)
      })
    )
    for (const [operationId, organisationId] of operations)
      await finishOperation(organisationId, operationId, options.requestId)
  }
  await reconcileResolvedChildren(
    options.requestId,
    summary,
    env.JOBS_BATCH_SIZE
  )
  // Batches the claim settled without running anything (every remaining
  // child expired) still finish, once.
  const settled = await getDatabase()<
    { organisationId: string; operationId: string }[]
  >`
    select organisation_id::text as "organisationId", operation_id::text as "operationId"
    from bulk_operations_ready_to_finish(${env.JOBS_BATCH_SIZE})`
  for (const row of settled)
    await finishOperation(
      row.organisationId,
      row.operationId,
      options.requestId
    )
  return summary
}
