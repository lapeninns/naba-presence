import "server-only"

import { bulkOperationInputSchema } from "@/lib/domain/bulk-merge"
import { writeAudit } from "@/lib/server/audit"
import {
  applyTarget,
  comparisonHash,
  currentFor,
  isApplied,
} from "@/lib/server/bulk-listing-targets"
import { getDatabase, jsonColumn, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  resolveGbpLocationContext,
  stableGoogleHash,
} from "@/lib/server/gbp-management"
import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { requireNoUnresolvedAccountChange, withGoogleAccountChangeLock } from "@/lib/server/google-account-change-lock"
import { log } from "@/lib/server/logger"
import { recordOperationalEvent } from "@/lib/server/notifications/operational"
import { canPublishLocation } from "@/lib/server/permissions"
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
  expiresAt: Date
}
export type BulkTickSummary = {
  children: number
  succeeded: number
  failed: number
  conflict: number
  ambiguous: number
  deferred: number
}

const WRITE_FLAG = {
  regular_hours: "profileWrites",
  special_hours: "profileWrites",
  more_hours: "profileWrites",
  attributes: "profileWrites",
  place_action: "placeActions",
} as const

async function settle(
  organisationId: string,
  childId: string,
  status: "succeeded" | "failed" | "conflict" | "ambiguous" | "queued",
  fields: {
    code?: string | null
    confirmation?: "confirmed" | "unresolved" | "unrecorded"
    observed?: unknown
  } = {}
) {
  await withTenant(
    organisationId,
    (sql) => sql`
    update bulk_listing_child set status = ${status}, result_code = ${fields.code ?? null},
      confirmation_state = ${fields.confirmation ?? "unrecorded"}, lease_expires_at = null,
      finished_at = ${status === "queued" ? null : sql`now()`},
      next_attempt_at = ${status === "queued" ? sql`now() + interval '1 minute'` : null},
      current_value = case when ${fields.observed !== undefined} then ${fields.observed === undefined ? null : jsonColumn(sql, fields.observed)} else current_value end
    where id = ${childId} and status = 'running'`
  )
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
        c.baseline_hash as "baselineHash", c.current_value as current, c.proposed_value as proposed, o.input, o.approved_by::text as "approvedBy",
        o.requested_by::text as "requestedBy", o.require_two_person_approval as "requireTwoPersonApproval", o.status as "operationStatus",
        o.execute_requested_at as "executeRequestedAt", o.approval_expires_at as "expiresAt"
      from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id where c.id = ${childId}`
    return row
  })
  if (!child) return
  const input = bulkOperationInputSchema.parse(child.input)
  const fail = async (code: string) => {
    await settle(organisationId, childId, "failed", { code })
    if (summary) summary.failed += 1
  }
  // Deferred execution rechecks: the approval, the approver's current grant
  // for this listing, the policy and the provider kill switch.
  const gate = await withTenant(organisationId, async (sql) => {
    if (child.operationStatus !== "running" || !child.approvedBy)
      return { code: "approval_invalid" }
    if (!child.executeRequestedAt || child.executeRequestedAt > child.expiresAt)
      return { code: "approval_expired" }
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    if ((policy?.required ?? false) !== child.requireTwoPersonApproval)
      return { code: "approval_policy_changed" }
    const [requester] =
      await sql`select 1 from member where user_id = ${child.requestedBy}`
    const [approver] = await sql<
      {
        role: Session["role"]
        canPublish: boolean
        email: string
        displayName: string
      }[]
    >`
      select m.role, m.can_publish as "canPublish", u.email, coalesce(u.display_name, '') as "displayName" from member m join app_user u on u.id = m.user_id where m.user_id = ${child.approvedBy}`
    if (!requester || !approver || !["owner", "admin"].includes(approver.role))
      return { code: "permission_revoked" }
    const session: Session = {
      sessionId: `bulk:${child.operationId}`,
      userId: child.approvedBy,
      organisationId,
      organisationName: "",
      displayName: approver.displayName,
      email: approver.email,
      role: approver.role,
      canPublish: approver.canPublish,
    }
    if (!(await canPublishLocation(sql, session, child.locationId)))
      return { code: "permission_revoked" }
    try {
      return {
        session,
        linked: await resolveGbpLocationContext(sql, session, child.locationId),
      }
    } catch (error) {
      return {
        code: error instanceof ApiError ? error.code : "connection_unavailable",
      }
    }
  })
  if ("code" in gate) return fail(gate.code ?? "approval_invalid")
  if (!gbpWritesEnabled(getServerEnv(), WRITE_FLAG[input.operation])) {
    await settle(organisationId, childId, "queued", {
      code: "publishing_paused",
    })
    if (summary) summary.deferred += 1
    return
  }
  let observed: unknown
  try {
    observed = await currentFor(input, gate.linked, child.updateMask)
  } catch (error) {
    if (error instanceof ApiError && error.code === "google_rate_limited") {
      await settle(organisationId, childId, "queued", {
        code: "google_rate_limited",
      })
      if (summary) summary.deferred += 1
      return
    }
    return fail(error instanceof ApiError ? error.code : "google_read_failed")
  }
  if (isApplied(input, observed, child.proposed)) {
    await settle(organisationId, childId, "succeeded", {
      confirmation: "confirmed",
      observed,
    })
    if (summary) summary.succeeded += 1
    return
  }
  const baselineUnchanged =
    input.operation === "place_action"
      ? stableGoogleHash(observed) === child.baselineHash
      : comparisonHash(observed) === comparisonHash(child.current)
  if (!baselineUnchanged) {
    await settle(organisationId, childId, "conflict", {
      code: "google_baseline_changed",
      observed,
    })
    if (summary) summary.conflict += 1
    return
  }
  // One write, then independent readback. Action links do both inside the
  // Google account lock after the same unresolved-outcome guard reviewed
  // Place Actions, access and lifecycle changes use.
  const writeAndConfirm = async (): Promise<"succeeded" | "ambiguous" | "deferred" | { failed: string }> => {
    if (input.operation === "place_action") await requireNoUnresolvedAccountChange(gate.session, gate.linked.googleAccountId)
    let ambiguous = false
    try { await applyTarget(input, gate.linked, child.proposed, child.updateMask) }
    catch (error) {
      if (error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)) {
        if (error.code === "google_rate_limited") { await settle(organisationId, childId, "queued", { code: error.code }); return "deferred" }
        return { failed: `provider_rejected:${error.code}` }
      }
      ambiguous = true
    }
    try {
      const after = await currentFor(input, gate.linked, child.updateMask)
      if (isApplied(input, after, child.proposed)) { await settle(organisationId, childId, "succeeded", { confirmation: "confirmed", observed: after }); return "succeeded" }
      await settle(organisationId, childId, "ambiguous", { code: ambiguous ? "response_ambiguous" : "readback_mismatch", confirmation: "unresolved", observed: after })
    } catch {
      await settle(organisationId, childId, "ambiguous", { code: "readback_failed", confirmation: "unresolved" })
    }
    return "ambiguous"
  }
  let outcome: Awaited<ReturnType<typeof writeAndConfirm>>
  try {
    outcome = input.operation === "place_action" ? await withGoogleAccountChangeLock(gate.session, child.locationId, writeAndConfirm) : await writeAndConfirm()
  } catch (error) {
    if (error instanceof ApiError && error.code === "administration_in_progress") { await settle(organisationId, childId, "queued", { code: error.code }); outcome = "deferred" }
    else outcome = { failed: error instanceof ApiError ? error.code : "google_confirmation_unresolved" }
  }
  if (typeof outcome === "object") return fail(outcome.failed)
  if (summary) summary[outcome] += 1
}

/** Completes an operation whose children are all settled, and reports failures once. */
async function finishOperation(
  organisationId: string,
  operationId: string,
  requestId: string
) {
  await withTenant(organisationId, async (sql) => {
    const [op] = await sql<
      { status: string; approvedBy: string }[]
    >`select status, approved_by::text as "approvedBy" from bulk_listing_operation where id = ${operationId} for update`
    if (!op || op.status !== "running") return
    const counts = Object.fromEntries(
      (
        await sql<{ status: string; count: number }[]>`
      select status, count(*)::int as count from bulk_listing_child where operation_id = ${operationId} group by status`
      ).map((row) => [row.status, row.count])
    )
    if ((counts.queued ?? 0) + (counts.running ?? 0) > 0) return
    const failed =
      (counts.failed ?? 0) + (counts.conflict ?? 0) + (counts.ambiguous ?? 0)
    await sql`update bulk_listing_operation set status = ${failed ? "completed_with_failures" : "completed"}, finished_at = now(), updated_at = now() where id = ${operationId}`
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
    if (failed) {
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
  }
  const env = getServerEnv(),
    deadline = Date.now() + options.budgetMs
  while (Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline) {
    const claimed = await getDatabase()<
      { organisationId: string; childId: string }[]
    >`
      select organisation_id::text as "organisationId", child_id::text as "childId"
      from claim_due_bulk_children(${env.JOBS_BATCH_SIZE}, ${Math.ceil(options.budgetMs / 1000) + 60}, ${env.JOBS_PER_ORGANISATION})`
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
          await settle(row.organisationId, row.childId, "ambiguous", {
            code: "execution_interrupted",
            confirmation: "unresolved",
          }).catch(() => undefined)
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
  return summary
}
