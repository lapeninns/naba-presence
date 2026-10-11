import "server-only"

import type { TransactionSql } from "postgres"
import type { z } from "zod"

import {
  bulkOperationListSchema,
  bulkOperationSchema,
  type bulkPreviewRequestSchema,
  type BulkOperationView,
} from "@/lib/contracts/bulk-listings"
import {
  BULK_PREVIEW_TTL_MS,
  bulkOperationInputSchema,
  bulkResourceKey,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { writeAudit } from "@/lib/server/audit"
import { planTarget, type TargetPlan } from "@/lib/server/bulk-listing-targets"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
import {
  resolveGbpLocationContext,
  stableGoogleHash,
} from "@/lib/server/gbp-management"
import { actorScopeFromMembership } from "@/lib/server/authz/actor"
import {
  currentApprovalPolicy,
  requireCurrentManager,
  requireSecondApprover,
  requireUnchangedTwoPersonPolicy,
  secondApproverSatisfied,
} from "@/lib/server/authz/approval-policy"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import {
  grantsFor,
  isManagerialRole,
  requireLocationActionForAll,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const PREVIEW_CONCURRENCY = 5
const NOT_FOUND = () =>
  new ApiError(
    404,
    "bulk_operation_not_found",
    "The bulk change was not found."
  )

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    })
  )
  return results
}

/**
 * Bulk listing changes ship dark: every route and the claim
 * (claim_due_bulk_children, 0260) serve only organisations with the
 * `bulk_actions` feature on. Off, the routes answer 404 as if the feature
 * did not exist; queued children of a running batch wait unclaimed and
 * expire with their dispatch window.
 */
const BULK_FEATURE = "bulk_actions" as const
const FEATURE_DISABLED = () =>
  new ApiError(
    404,
    "feature_disabled",
    "Bulk changes are not available for this workspace."
  )
async function requireBulkFeature(sql: TransactionSql, session: Session) {
  if (!(await isOrgFeatureEnabled(sql, session.organisationId, BULK_FEATURE)))
    throw FEATURE_DISABLED()
}

/** Whether the session's organisation has bulk listing changes on (pages and the board). */
export async function bulkActionsEnabled(organisationId: string) {
  return withTenant(organisationId, (sql) =>
    isOrgFeatureEnabled(sql, organisationId, BULK_FEATURE)
  )
}

/**
 * The status a reader sees. A window that closed is `expired` even before
 * the next tick's sweep (claim_due_bulk_children) records it, so a paused
 * runner never leaves an approvable stale preview on screen.
 */
const effectiveStatus = (sql: TransactionSql) => sql`case
    when o.status = 'previewed' and o.preview_expires_at <= now() then 'expired'
    when o.status = 'approved' and coalesce(o.dispatch_expires_at, now()) <= now() then 'expired'
    else o.status end`

/**
 * The same rule per listing: an unsent child of a batch whose window closed
 * reads `expired` (with the sweep's reason) before the sweep records it, so
 * a running batch past its 24 hours never shows listings as still queued.
 */
const windowClosed = (
  sql: TransactionSql
) => sql`c.status in ('previewed', 'queued') and (
    (o.status = 'previewed' and o.preview_expires_at <= now())
    or (o.status in ('approved', 'running') and coalesce(o.dispatch_expires_at, now()) <= now()))`
const effectiveChildStatus = (sql: TransactionSql) =>
  sql`case when ${windowClosed(sql)} then 'expired' else c.status end`
const effectiveChildCode = (sql: TransactionSql) =>
  sql`case when ${windowClosed(sql)} then case when o.approved_at is null then 'preview_expired' else 'dispatch_expired' end else c.result_code end`

function readableReason(error: unknown) {
  return error instanceof ApiError ? error.code : "google_read_failed"
}

const BULK_TARGETS_UNAVAILABLE = {
  code: "bulk_targets_unavailable",
  message:
    "One or more selected listings are not available to you. Refresh the selection.",
}

/**
 * Plans one bulk change for an explicit, frozen set of listings. Every
 * selected listing must be visible to the requester, who must be able to ask
 * for approval there: a batch that names a hidden listing is refused as a
 * whole, without saying which. Visible listings the requester cannot
 * publish, or that Google cannot take the change for, are kept as skipped
 * with a reason.
 */
export async function previewBulkOperation(
  session: Session,
  body: z.infer<typeof bulkPreviewRequestSchema>,
  requestId: string
) {
  if (session.role === "viewer")
    throw new ApiError(403, "forbidden", "Viewers cannot prepare bulk changes.")
  const input = bulkOperationInputSchema.parse(body.input)
  const ids = [...body.locationIds]
  const contexts = await withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    // Preparing a bulk change asks for its approval at every target, so it
    // needs that action everywhere, not just visibility.
    const grants = await requireLocationActionForAll(
      sql,
      session,
      ids,
      "request_approval",
      BULK_TARGETS_UNAVAILABLE
    )
    const [existing] = await sql<
      { count: number }[]
    >`select count(*)::int as count from location where id in ${sql(ids)}`
    if (existing.count !== ids.length) {
      throw new ApiError(
        404,
        BULK_TARGETS_UNAVAILABLE.code,
        BULK_TARGETS_UNAVAILABLE.message
      )
    }
    const resolved = await Promise.all(
      ids.map(async (locationId) => {
        if (!grants.get(locationId)?.canPublish)
          return { locationId, skip: "publish_not_allowed" as string }
        try {
          return {
            locationId,
            context: await resolveGbpLocationContext(sql, session, locationId),
          }
        } catch (error) {
          return {
            locationId,
            skip: error instanceof ApiError ? error.code : "not_linked",
          }
        }
      })
    )
    // The Google target each child is previewed against, frozen so the
    // runner refuses to write after a relink or reconnect.
    const connectionIds = [
      ...new Set(
        resolved.flatMap((target) =>
          "context" in target && target.context
            ? [target.context.connectionId]
            : []
        )
      ),
    ]
    const generations = new Map(
      connectionIds.length
        ? (
            await sql<{ id: string; generation: number }[]>`
              select id::text as id, credential_generation as generation
              from google_connection where id in ${sql(connectionIds)}`
          ).map((row) => [row.id, row.generation])
        : []
    )
    return resolved.map((target) =>
      "context" in target && target.context
        ? {
            ...target,
            frozen: {
              connectionId: target.context.connectionId,
              credentialGeneration:
                generations.get(target.context.connectionId) ?? null,
              googleLocationName: target.context.googleLocationName,
            },
          }
        : target
    )
  })
  // The 15-minute approval window runs from the Google reads, not from the
  // insert after them, which can be up to the route's duration later. The
  // elapsed time is measured here and applied to the database clock.
  const readsStartedAt = performance.now()
  const plans = await mapLimit(
    contexts,
    PREVIEW_CONCURRENCY,
    async (
      target
    ): Promise<{ locationId: string; plan: TargetPlan; frozen?: Frozen }> => {
      if (!("context" in target) || !target.context)
        return {
          locationId: target.locationId,
          plan: { eligible: false, reason: target.skip },
        }
      try {
        return {
          locationId: target.locationId,
          plan: await planTarget(input, target.context),
          frozen: target.frozen,
        }
      } catch (error) {
        return {
          locationId: target.locationId,
          plan: { eligible: false, reason: readableReason(error) },
          frozen: target.frozen,
        }
      }
    }
  )
  const children = plans.map(({ locationId, plan, frozen }) => ({
    locationId,
    frozen: frozen ?? null,
    eligibility: plan.eligible ? ("eligible" as const) : ("skipped" as const),
    skipReason: plan.eligible ? null : plan.reason,
    current: plan.current ?? null,
    proposed: plan.eligible ? plan.proposed : null,
    updateMask: plan.eligible ? plan.updateMask : [],
    baselineHash:
      plan.current === undefined ? null : stableGoogleHash(plan.current),
  }))
  const previewHash = stableGoogleHash({
    input,
    children: children.map(
      ({
        locationId,
        eligibility,
        skipReason,
        proposed,
        updateMask,
        baselineHash,
        frozen,
      }) => ({
        locationId,
        eligibility,
        skipReason,
        proposed,
        updateMask,
        baselineHash,
        frozen,
      })
    ),
  })
  return withTenant(session.organisationId, async (sql) => {
    const policy = await currentApprovalPolicy(sql, session.organisationId)
    const readSecondsAgo = Math.max(
      0,
      (performance.now() - readsStartedAt) / 1000
    )
    const [operation] = await sql<{ id: string }[]>`
      insert into bulk_listing_operation (organisation_id, operation, input, target_location_ids, preview_hash, requested_by, require_two_person_approval, preview_expires_at)
      values (${session.organisationId}, ${input.operation}, ${jsonColumn(sql, input)}, ${ids}::uuid[], ${previewHash}, ${session.userId}, ${policy.requireTwoPersonApproval},
        clock_timestamp() - make_interval(secs => ${readSecondsAgo}::float8) + make_interval(secs => ${BULK_PREVIEW_TTL_MS / 1000}::float8))
      returning id::text as id`
    const resourceKey = bulkResourceKey(input.operation)
    for (const child of children) {
      await sql`
        insert into bulk_listing_child (organisation_id, operation_id, location_id, eligibility, skip_reason, current_value, proposed_value, update_mask, baseline_hash, status,
          resource_key, connection_id, credential_generation, google_location_name)
        values (${session.organisationId}, ${operation.id}, ${child.locationId}, ${child.eligibility}, ${child.skipReason}, ${jsonColumnOrNull(sql, child.current)},
          ${jsonColumnOrNull(sql, child.proposed)}, ${child.updateMask}, ${child.baselineHash}, ${child.eligibility === "eligible" ? "previewed" : "skipped"},
          ${resourceKey}, ${child.frozen?.connectionId ?? null}, ${child.frozen?.credentialGeneration ?? null}, ${child.frozen?.googleLocationName ?? null})`
    }
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "bulk_listing.previewed",
      subjectType: "bulk_listing_operation",
      subjectId: operation.id,
      requestId,
      metadata: {
        operation: input.operation,
        targets: ids.length,
        eligible: children.filter((c) => c.eligibility === "eligible").length,
        previewHash,
      },
    })
    return project(sql, session, operation.id)
  })
}

type Frozen = {
  connectionId: string
  credentialGeneration: number | null
  googleLocationName: string
}

async function project(
  sql: TransactionSql,
  session: Session,
  operationId: string
): Promise<BulkOperationView> {
  const [operation] = await sql`
    select o.id::text as id, o.operation, o.input, ${effectiveStatus(sql)} as status, o.preview_hash as "previewHash", o.requested_by::text as "requestedBy",
      o.approved_by::text as "approvedBy", o.require_two_person_approval as "requiresSecondApprover", coalesce(o.dispatch_expires_at, o.preview_expires_at) as "approvalExpiresAt",
      o.preview_expires_at as "previewExpiresAt", o.dispatch_expires_at as "dispatchExpiresAt", o.created_at as "createdAt", o.finished_at as "finishedAt"
    from bulk_listing_operation o where o.id = ${operationId}`
  if (!operation) throw NOT_FOUND()
  const children = await sql`
    select c.id::text as id, c.location_id::text as "locationId", l.name as "locationName", c.eligibility, c.skip_reason as "skipReason", ${effectiveChildStatus(sql)} as status,
      c.confirmation_state as "confirmationState", ${effectiveChildCode(sql)} as "resultCode", c.current_value as "currentValue", c.proposed_value as "proposedValue",
      c.update_mask as "updateMask", c.attempts, c.finished_at as "finishedAt"
    from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id join location l on l.id = c.location_id
    where c.operation_id = ${operationId} order by l.name, c.id`
  const counts: Record<string, number> = {}
  for (const child of children)
    counts[child.status as string] = (counts[child.status as string] ?? 0) + 1
  return bulkOperationSchema.parse({
    ...operation,
    approvalExpiresAt: (operation.approvalExpiresAt as Date).toISOString(),
    previewExpiresAt: (operation.previewExpiresAt as Date).toISOString(),
    dispatchExpiresAt:
      (operation.dispatchExpiresAt as Date | null)?.toISOString() ?? null,
    createdAt: (operation.createdAt as Date).toISOString(),
    finishedAt: (operation.finishedAt as Date | null)?.toISOString() ?? null,
    canApprove:
      isManagerialRole(session.role) &&
      operation.status === "previewed" &&
      secondApproverSatisfied(
        operation.requiresSecondApprover,
        operation.requestedBy,
        session.userId
      ),
    counts,
    children: children.map((child) => ({
      ...child,
      finishedAt: (child.finishedAt as Date | null)?.toISOString() ?? null,
    })),
  })
}

async function loadForUpdate(sql: TransactionSql, operationId: string) {
  const [row] = await sql<
    {
      status: string
      previewHash: string
      requestedBy: string
      requireTwoPersonApproval: boolean
      previewExpiresAt: Date
      dispatchExpiresAt: Date | null
      input: BulkOperationInput
    }[]
  >`
    select status, preview_hash as "previewHash", requested_by::text as "requestedBy", require_two_person_approval as "requireTwoPersonApproval",
      preview_expires_at as "previewExpiresAt", dispatch_expires_at as "dispatchExpiresAt", input
    from bulk_listing_operation where id = ${operationId} for update`
  if (!row) throw NOT_FOUND()
  return row
}

/** Whether an approved batch's dispatch window (24 hours after approval) is still open. */
const dispatchOpen = (row: { dispatchExpiresAt: Date | null }) =>
  row.dispatchExpiresAt !== null && row.dispatchExpiresAt.getTime() > Date.now()

export async function readBulkOperation(session: Session, operationId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const view = await project(sql, session, operationId)
    if (!isManagerialRole(session.role) && view.requestedBy !== session.userId)
      throw NOT_FOUND()
    return view
  })
}

export async function listBulkOperations(session: Session) {
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const rows = await sql`
      select o.id::text as id, o.operation, ${effectiveStatus(sql)} as status, o.preview_hash as "previewHash", o.requested_by::text as "requestedBy", o.approved_by::text as "approvedBy",
        o.require_two_person_approval as "requiresSecondApprover", coalesce(o.dispatch_expires_at, o.preview_expires_at) as "approvalExpiresAt",
        o.preview_expires_at as "previewExpiresAt", o.dispatch_expires_at as "dispatchExpiresAt", o.created_at as "createdAt", o.finished_at as "finishedAt",
        cardinality(o.target_location_ids) as "targetCount",
        coalesce((select jsonb_object_agg(status, n) from (select ${effectiveChildStatus(sql)} as status, count(*)::int as n from bulk_listing_child c where c.operation_id = o.id group by 1) s), '{}'::jsonb) as counts
      from bulk_listing_operation o
      where ${isManagerialRole(session.role) ? sql`true` : sql`o.requested_by = ${session.userId}`}
      order by o.created_at desc limit 50`
    return bulkOperationListSchema.parse({
      operations: rows.map((row) => ({
        ...row,
        approvalExpiresAt: (row.approvalExpiresAt as Date).toISOString(),
        previewExpiresAt: (row.previewExpiresAt as Date).toISOString(),
        dispatchExpiresAt:
          (row.dispatchExpiresAt as Date | null)?.toISOString() ?? null,
        createdAt: (row.createdAt as Date).toISOString(),
        finishedAt: (row.finishedAt as Date | null)?.toISOString() ?? null,
        canApprove:
          isManagerialRole(session.role) &&
          row.status === "previewed" &&
          secondApproverSatisfied(
            row.requiresSecondApprover,
            row.requestedBy,
            session.userId
          ),
      })),
    })
  })
}

/** Approves one exact preview. Skipped listings must be acknowledged. */
export async function approveBulkOperation(
  session: Session,
  operationId: string,
  input: { expectedPreviewHash: string; acknowledgeSkipped: boolean },
  requestId: string
) {
  if (!isManagerialRole(session.role))
    throw new ApiError(
      403,
      "forbidden",
      "Only an owner or administrator can approve a bulk change."
    )
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const row = await loadForUpdate(sql, operationId)
    if (row.status !== "previewed")
      throw new ApiError(
        409,
        "bulk_not_awaiting_approval",
        "This bulk change is not waiting for approval."
      )
    // Fifteen minutes after the preview read Google. The refusal rolls back,
    // so the tick's sweep records the expiry; readers already see it.
    if (row.previewExpiresAt.getTime() <= Date.now())
      throw new ApiError(
        409,
        "approval_expired",
        "This preview expired. Prepare a new one."
      )
    if (row.previewHash !== input.expectedPreviewHash)
      throw new ApiError(
        409,
        "approval_stale",
        "The preview changed. Review it again."
      )
    await requireUnchangedTwoPersonPolicy(
      sql,
      session.organisationId,
      row.requireTwoPersonApproval,
      "The approval policy changed. Prepare a new preview."
    )
    // Under two-person approval the requester is never the approver; the
    // table enforces the same rule (bulk_listing_operation_second_approver).
    requireSecondApprover(
      row.requireTwoPersonApproval,
      row.requestedBy,
      session.userId,
      "A different authorised user must approve this bulk change."
    )
    await requireCurrentManager(sql, session.organisationId, session.userId)
    if (
      !(await actorScopeFromMembership(
        sql,
        session.organisationId,
        row.requestedBy
      ))
    )
      throw new ApiError(
        409,
        "approval_actor_access_changed",
        "The person who prepared this change is no longer a member."
      )
    const eligible = await sql<
      { locationId: string }[]
    >`select location_id::text as "locationId" from bulk_listing_child where operation_id = ${operationId} and eligibility = 'eligible'`
    const [{ skipped }] = await sql<
      { skipped: number }[]
    >`select count(*)::int as skipped from bulk_listing_child where operation_id = ${operationId} and eligibility = 'skipped'`
    if (!eligible.length)
      throw new ApiError(
        409,
        "bulk_nothing_eligible",
        "No selected listing can take this change."
      )
    if (skipped > 0 && !input.acknowledgeSkipped)
      throw new ApiError(
        409,
        "bulk_skipped_unacknowledged",
        "Acknowledge the skipped listings before approving."
      )
    const grants = await grantsFor(
      sql,
      session,
      eligible.map((row) => row.locationId)
    )
    if ([...grants.values()].some((grant) => !grant.canPublish))
      throw new ApiError(
        403,
        "publish_not_allowed",
        "You cannot publish to every listing in this change."
      )
    // Dispatch is open for 24 hours from this approval, per child.
    // INTEGRATION: stream A (MFA, P02-S9) records the approver's verified
    // assurance here (approver_aal, authorised_security_version, reserved in
    // 0261); the runner already passes the stored version to
    // recheckAuthorisation.
    await sql`update bulk_listing_operation set status = 'approved', approved_by = ${session.userId}, approved_at = now(), skipped_acknowledged = ${skipped > 0},
      dispatch_expires_at = now() + interval '24 hours', approval_expires_at = now() + interval '24 hours', updated_at = now() where id = ${operationId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "bulk_listing.approved",
      subjectType: "bulk_listing_operation",
      subjectId: operationId,
      requestId,
      metadata: {
        previewHash: row.previewHash,
        eligible: eligible.length,
        skipped,
      },
    })
    return project(sql, session, operationId)
  })
}

/** Queues the approved children. Returns at once; the job tick does the writes. */
export async function executeBulkOperation(
  session: Session,
  operationId: string,
  requestId: string
) {
  if (!isManagerialRole(session.role))
    throw new ApiError(
      403,
      "forbidden",
      "Only an owner or administrator can start a bulk change."
    )
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const row = await loadForUpdate(sql, operationId)
    if (row.status === "running") return project(sql, session, operationId)
    if (row.status !== "approved")
      throw new ApiError(
        409,
        "approval_required",
        "Approve this bulk change before starting it."
      )
    if (!dispatchOpen(row))
      throw new ApiError(
        409,
        "approval_expired",
        "This approval expired. Prepare a new preview."
      )
    await sql`update bulk_listing_operation set status = 'running', execute_requested_at = now(), updated_at = now() where id = ${operationId}`
    await sql`update bulk_listing_child set status = 'queued', next_attempt_at = now() where operation_id = ${operationId} and status = 'previewed'`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "bulk_listing.started",
      subjectType: "bulk_listing_operation",
      subjectId: operationId,
      requestId,
    })
    return project(sql, session, operationId)
  })
}

/** Stops unstarted children. Completed writes stay; nothing is rolled back. */
export async function cancelBulkOperation(
  session: Session,
  operationId: string,
  requestId: string
) {
  if (!isManagerialRole(session.role))
    throw new ApiError(
      403,
      "forbidden",
      "Only an owner or administrator can cancel a bulk change."
    )
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const row = await loadForUpdate(sql, operationId)
    if (
      ["completed", "completed_with_failures", "cancelled", "expired"].includes(
        row.status
      )
    )
      throw new ApiError(
        409,
        "bulk_closed",
        "This bulk change has already finished."
      )
    const cancelled =
      await sql`update bulk_listing_child set status = 'cancelled', finished_at = now() where operation_id = ${operationId} and status in ('previewed', 'queued') returning id`
    await sql`update bulk_listing_operation set status = 'cancelled', finished_at = coalesce(finished_at, now()), updated_at = now() where id = ${operationId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "bulk_listing.cancelled",
      subjectType: "bulk_listing_operation",
      subjectId: operationId,
      requestId,
      metadata: { cancelledChildren: cancelled.length },
    })
    return project(sql, session, operationId)
  })
}

/**
 * Requeues failed and unresolved children. Each re-reads Google first: a
 * listing already showing the change settles as succeeded without a write,
 * and one whose value moved away from the preview becomes a conflict that
 * needs a new preview. Succeeded children are never touched.
 */
export async function retryBulkOperation(
  session: Session,
  operationId: string,
  requestId: string
) {
  if (!isManagerialRole(session.role))
    throw new ApiError(
      403,
      "forbidden",
      "Only an owner or administrator can retry a bulk change."
    )
  return withTenant(session.organisationId, async (sql) => {
    await requireBulkFeature(sql, session)
    const row = await loadForUpdate(sql, operationId)
    if (!["completed_with_failures", "running"].includes(row.status))
      throw new ApiError(
        409,
        "bulk_not_retryable",
        "Only a bulk change with failed listings can be retried."
      )
    if (!dispatchOpen(row))
      throw new ApiError(
        409,
        "approval_expired",
        "This approval expired. Prepare a new preview for the remaining listings."
      )
    const retried =
      await sql`update bulk_listing_child set status = 'queued', next_attempt_at = now(), result_code = null
      where operation_id = ${operationId} and status in ('failed', 'ambiguous') returning id`
    if (retried.length)
      await sql`update bulk_listing_operation set status = 'running', finished_at = null, updated_at = now() where id = ${operationId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "bulk_listing.retried",
      subjectType: "bulk_listing_operation",
      subjectId: operationId,
      requestId,
      metadata: { children: retried.length },
    })
    return project(sql, session, operationId)
  })
}
