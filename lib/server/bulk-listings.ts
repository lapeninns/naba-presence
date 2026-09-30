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
  bulkOperationInputSchema,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { writeAudit } from "@/lib/server/audit"
import { planTarget, type TargetPlan } from "@/lib/server/bulk-listing-targets"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
import {
  resolveGbpLocationContext,
  stableGoogleHash,
} from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import { grantsFor, isManagerialRole } from "@/lib/server/permissions"
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

function readableReason(error: unknown) {
  return error instanceof ApiError ? error.code : "google_read_failed"
}

/**
 * Plans one bulk change for an explicit, frozen set of listings. Every
 * selected listing must be visible to the requester: a batch that names a
 * hidden listing is refused as a whole, without saying which. Visible
 * listings the requester cannot publish, or that Google cannot take the
 * change for, are kept as skipped with a reason.
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
    const grants = await grantsFor(sql, session, ids)
    const [existing] = await sql<
      { count: number }[]
    >`select count(*)::int as count from location where id in ${sql(ids)}`
    if (
      [...grants.values()].some((grant) => !grant.visible) ||
      existing.count !== ids.length
    ) {
      throw new ApiError(
        404,
        "bulk_targets_unavailable",
        "One or more selected listings are not available to you. Refresh the selection."
      )
    }
    return Promise.all(
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
  })
  const plans = await mapLimit(
    contexts,
    PREVIEW_CONCURRENCY,
    async (target): Promise<{ locationId: string; plan: TargetPlan }> => {
      if (!("context" in target) || !target.context)
        return {
          locationId: target.locationId,
          plan: { eligible: false, reason: target.skip },
        }
      try {
        return {
          locationId: target.locationId,
          plan: await planTarget(input, target.context),
        }
      } catch (error) {
        return {
          locationId: target.locationId,
          plan: { eligible: false, reason: readableReason(error) },
        }
      }
    }
  )
  const children = plans.map(({ locationId, plan }) => ({
    locationId,
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
      }) => ({
        locationId,
        eligibility,
        skipReason,
        proposed,
        updateMask,
        baselineHash,
      })
    ),
  })
  return withTenant(session.organisationId, async (sql) => {
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    const [operation] = await sql<{ id: string }[]>`
      insert into bulk_listing_operation (organisation_id, operation, input, target_location_ids, preview_hash, requested_by, require_two_person_approval)
      values (${session.organisationId}, ${input.operation}, ${jsonColumn(sql, input)}, ${ids}::uuid[], ${previewHash}, ${session.userId}, ${policy?.required ?? false})
      returning id::text as id`
    for (const child of children) {
      await sql`
        insert into bulk_listing_child (organisation_id, operation_id, location_id, eligibility, skip_reason, current_value, proposed_value, update_mask, baseline_hash, status)
        values (${session.organisationId}, ${operation.id}, ${child.locationId}, ${child.eligibility}, ${child.skipReason}, ${jsonColumnOrNull(sql, child.current)},
          ${jsonColumnOrNull(sql, child.proposed)}, ${child.updateMask}, ${child.baselineHash}, ${child.eligibility === "eligible" ? "previewed" : "skipped"})`
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

async function project(
  sql: TransactionSql,
  session: Session,
  operationId: string
): Promise<BulkOperationView> {
  const [operation] = await sql`
    select id::text as id, operation, input, status, preview_hash as "previewHash", requested_by::text as "requestedBy", approved_by::text as "approvedBy",
      require_two_person_approval as "requiresSecondApprover", approval_expires_at as "approvalExpiresAt", created_at as "createdAt", finished_at as "finishedAt"
    from bulk_listing_operation where id = ${operationId}`
  if (!operation) throw NOT_FOUND()
  const children = await sql`
    select c.id::text as id, c.location_id::text as "locationId", l.name as "locationName", c.eligibility, c.skip_reason as "skipReason", c.status,
      c.confirmation_state as "confirmationState", c.result_code as "resultCode", c.current_value as "currentValue", c.proposed_value as "proposedValue",
      c.update_mask as "updateMask", c.attempts, c.finished_at as "finishedAt"
    from bulk_listing_child c join location l on l.id = c.location_id where c.operation_id = ${operationId} order by l.name, c.id`
  const counts: Record<string, number> = {}
  for (const child of children)
    counts[child.status as string] = (counts[child.status as string] ?? 0) + 1
  return bulkOperationSchema.parse({
    ...operation,
    approvalExpiresAt: (operation.approvalExpiresAt as Date).toISOString(),
    createdAt: (operation.createdAt as Date).toISOString(),
    finishedAt: (operation.finishedAt as Date | null)?.toISOString() ?? null,
    canApprove:
      isManagerialRole(session.role) &&
      operation.status === "previewed" &&
      (!operation.requiresSecondApprover ||
        operation.requestedBy !== session.userId),
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
      expiresAt: Date
      input: BulkOperationInput
    }[]
  >`
    select status, preview_hash as "previewHash", requested_by::text as "requestedBy", require_two_person_approval as "requireTwoPersonApproval",
      approval_expires_at as "expiresAt", input
    from bulk_listing_operation where id = ${operationId} for update`
  if (!row) throw NOT_FOUND()
  return row
}

export async function readBulkOperation(session: Session, operationId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const view = await project(sql, session, operationId)
    if (!isManagerialRole(session.role) && view.requestedBy !== session.userId)
      throw NOT_FOUND()
    return view
  })
}

export async function listBulkOperations(session: Session) {
  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql`
      select o.id::text as id, o.operation, o.status, o.preview_hash as "previewHash", o.requested_by::text as "requestedBy", o.approved_by::text as "approvedBy",
        o.require_two_person_approval as "requiresSecondApprover", o.approval_expires_at as "approvalExpiresAt", o.created_at as "createdAt", o.finished_at as "finishedAt",
        cardinality(o.target_location_ids) as "targetCount",
        coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int as n from bulk_listing_child c where c.operation_id = o.id group by status) s), '{}'::jsonb) as counts
      from bulk_listing_operation o
      where ${isManagerialRole(session.role) ? sql`true` : sql`o.requested_by = ${session.userId}`}
      order by o.created_at desc limit 50`
    return bulkOperationListSchema.parse({
      operations: rows.map((row) => ({
        ...row,
        approvalExpiresAt: (row.approvalExpiresAt as Date).toISOString(),
        createdAt: (row.createdAt as Date).toISOString(),
        finishedAt: (row.finishedAt as Date | null)?.toISOString() ?? null,
        canApprove:
          isManagerialRole(session.role) &&
          row.status === "previewed" &&
          (!row.requiresSecondApprover || row.requestedBy !== session.userId),
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
    const row = await loadForUpdate(sql, operationId)
    if (row.status !== "previewed")
      throw new ApiError(
        409,
        "bulk_not_awaiting_approval",
        "This bulk change is not waiting for approval."
      )
    if (row.expiresAt.getTime() <= Date.now()) {
      await sql`update bulk_listing_operation set status = 'expired', updated_at = now() where id = ${operationId}`
      throw new ApiError(
        409,
        "approval_expired",
        "This preview expired. Prepare a new one."
      )
    }
    if (row.previewHash !== input.expectedPreviewHash)
      throw new ApiError(
        409,
        "approval_stale",
        "The preview changed. Review it again."
      )
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    if ((policy?.required ?? false) !== row.requireTwoPersonApproval)
      throw new ApiError(
        409,
        "approval_policy_changed",
        "The approval policy changed. Prepare a new preview."
      )
    if (row.requireTwoPersonApproval && row.requestedBy === session.userId)
      throw new ApiError(
        409,
        "second_approver_required",
        "A different authorised user must approve this bulk change."
      )
    const [requester] =
      await sql`select 1 from member where user_id = ${row.requestedBy}`
    if (!requester)
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
    await sql`update bulk_listing_operation set status = 'approved', approved_by = ${session.userId}, approved_at = now(), skipped_acknowledged = ${skipped > 0}, updated_at = now() where id = ${operationId}`
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
    const row = await loadForUpdate(sql, operationId)
    if (row.status === "running") return project(sql, session, operationId)
    if (row.status !== "approved")
      throw new ApiError(
        409,
        "approval_required",
        "Approve this bulk change before starting it."
      )
    if (row.expiresAt.getTime() <= Date.now())
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
    const row = await loadForUpdate(sql, operationId)
    if (!["completed_with_failures", "running"].includes(row.status))
      throw new ApiError(
        409,
        "bulk_not_retryable",
        "Only a bulk change with failed listings can be retried."
      )
    if (row.expiresAt.getTime() <= Date.now())
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
