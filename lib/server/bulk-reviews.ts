import "server-only"

import type { TransactionSql } from "postgres"

import type {
  BulkApprovalItem,
  BulkReviewResult,
} from "@/lib/contracts/reviews"
import { BULK_DISPATCH_TTL_MS } from "@/lib/domain/bulk-merge"
import {
  templateSkipCode,
  type BulkReviewInput,
} from "@/lib/domain/bulk-reviews"
import { writeAudit } from "@/lib/server/audit"
import { jsonColumn, withTenant } from "@/lib/server/db"
import {
  resolveGbpLocationContext,
  stableGoogleHash,
} from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { requireLocationAction } from "@/lib/server/permissions"
import { recordApprovalDecision } from "@/lib/server/review-approval"
import { rowFromError } from "@/lib/server/review-bulk-outcome"
import type { Session } from "@/lib/server/session"

/**
 * Bulk review work on the bulk engine (P09-R8): the inbox's bulk approve
 * and its template replies become one bulk batch each, whose children the
 * job runner sends one review at a time (lib/server/bulk-families/reviews.ts)
 * and whose outcomes survive the tab that started them
 * (`GET /api/listings/bulk/{id}`, the batch page).
 *
 * Behind the organisation's `bulk_actions` feature, like every bulk batch.
 * Without it, approve stays the synchronous per-row loop and template
 * replies stay the inbox's own two-step run (components/inbox).
 *
 * A review batch is started and decided by one person: there is no
 * separate preview to approve. For approvals that person is the approver,
 * whose decisions are recorded here, row by row, exactly as the
 * synchronous path records them (`recordApprovalDecision`); for template
 * replies they are the author, and each reply's publish decides whether it
 * needs someone else's approval. So the batch carries no batch-level
 * two-person flag (require_two_person_approval is false and the runner's
 * recheck is per item, `perItemApproval`): two-person policy is applied per
 * review, where it always has been.
 */

type Row = BulkReviewResult["results"][number]
type Ctx = { requestId: string; clientRequestId?: string | null }

export async function bulkReviewEngineEnabled(
  sql: TransactionSql,
  organisationId: string
) {
  return isOrgFeatureEnabled(sql, organisationId, "bulk_actions")
}

type Frozen = {
  connectionId: string
  credentialGeneration: number | null
  googleLocationName: string
}

type Planned = {
  reviewId: string
  locationId: string
  input: BulkReviewInput
  frozen: Frozen | null
  skip: string | null
  /** The row's own outcome when it was refused (failed rather than skipped). */
  refused?: Row
}

/** The Google target each child is sent against, frozen like a listing child's. */
async function freezeTarget(
  sql: TransactionSql,
  session: Session,
  locationId: string,
  cache: Map<string, Frozen>
): Promise<Frozen> {
  const known = cache.get(locationId)
  if (known) return known
  const context = await resolveGbpLocationContext(sql, session, locationId)
  const [connection] = await sql<{ generation: number }[]>`
    select credential_generation as generation from google_connection where id = ${context.connectionId}`
  const frozen = {
    connectionId: context.connectionId,
    credentialGeneration: connection?.generation ?? null,
    googleLocationName: context.googleLocationName,
  }
  cache.set(locationId, frozen)
  return frozen
}

/**
 * Inserts the batch, already running: one child per planned review, the
 * eligible ones queued for the next tick and the rest skipped with their
 * reason. Returns null when nothing was eligible (no batch is made).
 */
async function insertBatch(
  sql: TransactionSql,
  session: Session,
  operation: BulkReviewInput["operation"],
  planned: Planned[],
  ctx: Ctx
): Promise<string | null> {
  if (!planned.some((entry) => entry.skip === null)) return null
  const items = planned.map((entry) => entry.input)
  const targets = [...new Set(planned.map((entry) => entry.locationId))]
  const [batch] = await sql<{ id: string }[]>`
    insert into bulk_listing_operation (organisation_id, operation, input, items, target_location_ids, preview_hash, status,
      requested_by, approved_by, approved_at, require_two_person_approval, skipped_acknowledged, execute_requested_at,
      dispatch_expires_at, approval_expires_at)
    values (${session.organisationId}, ${operation}, ${items.length === 1 ? jsonColumn(sql, items[0]) : null}, ${jsonColumn(sql, items)},
      ${targets}::uuid[], ${stableGoogleHash({ operation, items })}, 'running', ${session.userId}, ${session.userId}, now(), false,
      ${planned.some((entry) => entry.skip !== null)}, now(),
      now() + make_interval(secs => ${BULK_DISPATCH_TTL_MS / 1000}::float8), now() + make_interval(secs => ${BULK_DISPATCH_TTL_MS / 1000}::float8))
    returning id::text as id`
  for (const [seq, entry] of planned.entries()) {
    const eligible = entry.skip === null
    await sql`
      insert into bulk_listing_child (organisation_id, operation_id, location_id, eligibility, skip_reason, status, next_attempt_at,
        resource_key, connection_id, credential_generation, google_location_name, seq, item_key, input, review_id)
      values (${session.organisationId}, ${batch.id}, ${entry.locationId}, ${eligible ? "eligible" : "skipped"}, ${entry.skip},
        ${eligible ? "queued" : "skipped"}, ${eligible ? sql`now()` : null}, 'reviews', ${entry.frozen?.connectionId ?? null},
        ${entry.frozen?.credentialGeneration ?? null}, ${entry.frozen?.googleLocationName ?? null}, ${seq}, ${`${seq}:${operation}`},
        ${jsonColumn(sql, entry.input)}, ${entry.reviewId})`
  }
  await writeAudit(sql, {
    organisationId: session.organisationId,
    actorUserId: session.userId,
    action: "bulk_listing.started",
    subjectType: "bulk_listing_operation",
    subjectId: batch.id,
    requestId: ctx.requestId,
    metadata: {
      operation,
      reviews: planned.length,
      queued: planned.filter((entry) => entry.skip === null).length,
      clientRequestId: ctx.clientRequestId,
    },
  })
  return batch.id
}

/** A row's outcome when the batch was started: queued, or why not. */
function rowsFor(planned: Planned[], operationId: string | null): Row[] {
  return planned.map((entry): Row => {
    if (entry.refused) return entry.refused
    return entry.skip === null && operationId
      ? { reviewId: entry.reviewId, status: "queued" }
      : {
          reviewId: entry.reviewId,
          status: "skipped",
          ...(entry.skip ? { code: entry.skip } : {}),
        }
  })
}

/**
 * Bulk approve on the engine. Each row's decision is recorded in its own
 * savepoint with the synchronous path's rules (publish right, two-person,
 * the draft and review version shown); a refused row is skipped with its
 * code and nothing recorded for it. The approved rows are published by the
 * runner, as the approver, only while each decision still stands.
 */
export async function startBulkReviewApprovals(
  session: Session,
  approvals: readonly BulkApprovalItem[],
  ctx: Ctx
): Promise<BulkReviewResult> {
  return withTenant(session.organisationId, async (sql) => {
    const targets = new Map<string, Frozen>()
    const planned: Planned[] = []
    const unknown: Row[] = []
    for (const item of approvals) {
      const [review] = await sql<{ locationId: string }[]>`
        select location_id::text as "locationId" from review where id = ${item.reviewId}`
      if (!review) {
        unknown.push({
          reviewId: item.reviewId,
          status: "skipped",
          code: "review_not_found",
        })
        continue
      }
      const input = {
        operation: "review_approval" as const,
        reviewId: item.reviewId,
        draftId: item.draftId,
        reviewUpdateTime: item.reviewUpdateTime,
      }
      try {
        const settled = await sql.savepoint(async (sp) => {
          // Linked first: a review whose listing cannot be sent to is
          // refused before any decision is recorded for it.
          const frozen = await freezeTarget(
            sp,
            session,
            review.locationId,
            targets
          )
          const decision = await recordApprovalDecision(
            sp,
            session,
            item.reviewId,
            {
              decision: "approve",
              draftId: item.draftId,
              expectedReviewUpdateTime: item.reviewUpdateTime,
            },
            ctx
          )
          if (decision.kind !== "approved")
            throw new ApiError(
              409,
              "approval_not_pending",
              "This review is not awaiting approval."
            )
          return { frozen, decision }
        })
        planned.push({
          reviewId: item.reviewId,
          locationId: review.locationId,
          input: {
            ...input,
            draftId: settled.decision.draftId,
            reviewUpdateTime: settled.decision.expectedReviewUpdateTime,
          },
          frozen: settled.frozen,
          skip: null,
        })
      } catch (error) {
        const row = rowFromError(item.reviewId, error, "before_commit", {
          requestId: ctx.requestId,
          session,
        })
        planned.push({
          reviewId: item.reviewId,
          locationId: review.locationId,
          input,
          frozen: null,
          skip: row.code ?? "bulk_row_failed",
          refused: row,
        })
      }
    }
    const operationId = await insertBatch(
      sql,
      session,
      "review_approval",
      planned,
      ctx
    )
    return {
      ...(operationId ? { operationId } : {}),
      results: [...rowsFor(planned, operationId), ...unknown],
    }
  })
}

/**
 * Template replies on the engine: the selected rating-only reviews that
 * are untouched (no text, no draft, no reply, nothing under way) and, unless
 * asked, not 1 or 2 stars, each become a child that drafts, checks and
 * publishes (or submits for approval) one template reply. The rest are
 * skipped with the reason the inbox shows for them.
 */
export async function startBulkTemplateReplies(
  session: Session,
  input: { reviewIds: readonly string[]; includeLowRatings: boolean },
  ctx: Ctx
): Promise<BulkReviewResult> {
  return withTenant(session.organisationId, async (sql) => {
    const targets = new Map<string, Frozen>()
    const planned: Planned[] = []
    const unknown: Row[] = []
    for (const reviewId of input.reviewIds) {
      const [review] = await sql<
        {
          locationId: string
          updateTime: Date
          text: string | null
          rating: number | null
          workflowStatus: string
          restricted: boolean
          hasDraft: boolean
          hasReply: boolean
        }[]
      >`
        select r.location_id::text as "locationId", r.update_time as "updateTime", r.review_text as text,
          r.star_rating::integer as rating, r.workflow_status as "workflowStatus", r.restricted_at is not null as restricted,
          exists (select 1 from draft d where d.review_id = r.id) as "hasDraft",
          exists (select 1 from review_reply rr where rr.review_id = r.id and rr.current_body is not null
            and rr.publish_status <> 'deleted') as "hasReply"
        from review r where r.id = ${reviewId} and r.provider_deleted_at is null`
      if (!review) {
        unknown.push({ reviewId, status: "skipped", code: "review_not_found" })
        continue
      }
      const child = {
        operation: "review_template_reply" as const,
        reviewId,
        reviewUpdateTime: review.updateTime.toISOString(),
      }
      let skip: string | null = null
      let frozen: Frozen | null = null
      try {
        // Drafting a reply and asking for its publication, as the single
        // reply path requires of its author.
        await requireLocationAction(
          sql,
          session,
          review.locationId,
          "request_approval"
        )
        skip = templateSkipCode(review, {
          includeLowRatings: input.includeLowRatings,
        })
        if (!skip)
          frozen = await freezeTarget(sql, session, review.locationId, targets)
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        skip = error.code
      }
      planned.push({
        reviewId,
        locationId: review.locationId,
        input: child,
        frozen,
        skip,
      })
    }
    const operationId = await insertBatch(
      sql,
      session,
      "review_template_reply",
      planned,
      ctx
    )
    return {
      ...(operationId ? { operationId } : {}),
      results: [...rowsFor(planned, operationId), ...unknown],
    }
  })
}
