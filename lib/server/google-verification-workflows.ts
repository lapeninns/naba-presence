import "server-only"

import { z } from "zod"
import { verificationWorkflowItemSchema, type VerificationWorkflowQuery, type VerificationWorkflowResponse } from "@/lib/contracts/google-verification-workflows"
import { withTenant } from "@/lib/server/db"
import { currentVerificationContext } from "@/lib/server/google-verification-state"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const cursorSchema = z.strictObject({
  version: z.literal(1), locationId: z.uuid(), googleLocationName: z.string().max(512),
  accountId: z.uuid(), connectionId: z.uuid(),
  operation: z.enum(["all", "start", "complete"]), includeExpired: z.enum(["true", "false"]),
  stage: z.enum(["all", "reviews", "attempts"]),
  at: z.iso.datetime(), id: z.uuid(),
})
const rowSchema = verificationWorkflowItemSchema.omit({ attempt: true, canApprove: true }).extend({
  attemptId: z.uuid().nullable(), attemptStatus: verificationWorkflowItemSchema.shape.attempt.unwrap().shape.status.nullable(),
  executionState: verificationWorkflowItemSchema.shape.attempt.unwrap().shape.executionState.nullable(),
  confirmationState: verificationWorkflowItemSchema.shape.attempt.unwrap().shape.confirmationState.nullable(),
  observedAt: z.iso.datetime().nullable(),
})

/** A credential-free, read-only index. Detail/approval/execution retain their own current preflight. */
export async function listVerificationWorkflows(session: Session, locationId: string, query: VerificationWorkflowQuery): Promise<VerificationWorkflowResponse> {
  const linked = await currentVerificationContext(session, locationId, { requireActiveConnection: false })
  const scope = { version: 1, locationId, googleLocationName: linked.googleLocationName, accountId: linked.googleAccountId, connectionId: linked.connectionId, operation: query.operation, stage: query.stage, includeExpired: query.includeExpired } as const
  let cursor: z.infer<typeof cursorSchema> | null = null
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))) }
    catch (error) {
      if (error instanceof Error) throw new ApiError(400, "invalid_cursor", "The verification cursor is invalid. Reload the saved workflows.")
      throw error
    }
    if (cursor.locationId !== locationId || cursor.googleLocationName !== scope.googleLocationName || cursor.accountId !== scope.accountId || cursor.connectionId !== scope.connectionId || cursor.operation !== query.operation || cursor.stage !== query.stage || cursor.includeExpired !== query.includeExpired) throw new ApiError(400, "invalid_cursor", "The listing or filters changed. Reload the saved workflows.")
  }
  return withTenant(session.organisationId, async (sql) => {
    const [manager] = await sql<{ readonly role: string }[]>`select role from member where user_id = ${session.userId}`
    if (!manager || (manager.role !== "owner" && manager.role !== "admin")) throw new ApiError(403, "verification_access_changed", "Your access changed. Refresh before checking verification again.")
    const rows = await sql`
      select c.id as "reviewId", to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        case when c.resource_type = 'verification_start' then 'start_verification' else 'complete_verification' end as operation,
        case when c.payload ->> 'method' in ('EMAIL', 'PHONE_CALL', 'SMS', 'ADDRESS', 'AUTO') then c.payload ->> 'method' else 'UNKNOWN' end as method,
        c.payload_hash as "payloadHash", c.requested_by as "requestedBy", c.approved_by as "approvedBy",
        c.require_two_person_approval as "requiresSecondApprover",
        to_char(c.approval_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        case when c.approval_expires_at <= now() then 'expired'
          when c.require_two_person_approval <> o.require_two_person_approval then 'policy_changed'
          when r.role is null or r.role not in ('owner', 'admin') or (c.approved_by is not null and (a.role is null or a.role not in ('owner', 'admin'))) then 'actor_access_changed'
          when c.baseline ->> 'credentialGeneration' is distinct from ${String(linked.credentialGeneration)} then 'credential_changed'
          when not ga.is_active or gc.status not in ('active', 'expired') then 'reconnect_required'
          when c.payload ->> 'method' is null or c.payload ->> 'method' not in ('EMAIL', 'PHONE_CALL', 'SMS', 'ADDRESS', 'AUTO') then 'review_unreadable'
          when ${!linked.canPublish} then 'publish_not_allowed' else null end as "reviewReason",
        m.id as "attemptId", m.status as "attemptStatus", m.execution_state as "executionState", m.confirmation_state as "confirmationState",
        to_char(m.confirmation_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "observedAt"
      from gbp_change_set c join organisation o on o.id = c.organisation_id
      join google_account ga on ga.id = c.google_account_id join google_connection gc on gc.id = c.connection_id
      left join member r on r.organisation_id = c.organisation_id and r.user_id = c.requested_by
      left join member a on a.organisation_id = c.organisation_id and a.user_id = c.approved_by
      left join gbp_management_mutation m on m.change_set_id = c.id and m.resource_type = 'verification'
        and m.operation = case when c.resource_type = 'verification_start' then 'start_verification' else 'complete_verification' end
      where c.location_id = ${locationId} and c.google_account_id = ${linked.googleAccountId}
        and c.connection_id = ${linked.connectionId} and c.target_resource_name = ${linked.googleLocationName}
        and c.resource_type in ('verification_start', 'verification_complete')
        and (${query.operation === "all"} or c.resource_type = ${query.operation === "start" ? "verification_start" : "verification_complete"})
        and (${query.stage === "all"} or (${query.stage === "reviews"} and m.id is null) or (${query.stage === "attempts"} and m.id is not null))
        and (${query.includeExpired === "true"} or c.approval_expires_at > now() or m.id is not null)
        and (${cursor === null} or (c.created_at, c.id) < (${cursor?.at ?? null}::text::timestamptz, ${cursor?.id ?? null}::uuid))
      order by c.created_at desc, c.id desc limit ${query.pageSize + 1}
    `
    const parsed = z.array(rowSchema).safeParse(rows)
    if (!parsed.success) throw new ApiError(409, "verification_workflows_unreadable", "Saved verification workflows are unreadable. Use the location activity history for an operational check.")
    const page = parsed.data.slice(0, query.pageSize)
    const workflows = page.map((row) => {
      const { attemptId, attemptStatus, executionState, confirmationState, observedAt, ...review } = row
      if (attemptId && (!attemptStatus || !executionState || !confirmationState)) throw new ApiError(409, "verification_workflows_unreadable", "A saved verification outcome is unreadable. Use the location activity history for an operational check.")
      return verificationWorkflowItemSchema.parse({ ...review,
        canApprove: !attemptId && !row.approvedBy && !row.reviewReason && (!row.requiresSecondApprover || row.requestedBy !== session.userId),
        attempt: attemptId ? { id: attemptId, status: attemptStatus, executionState, confirmationState, observedAt } : null,
      })
    })
    const last = page.at(-1)
    const nextCursor = parsed.data.length > query.pageSize && last ? Buffer.from(JSON.stringify({ ...scope, at: last.createdAt, id: last.reviewId })).toString("base64url") : null
    return { workflows, nextCursor }
  })
}
