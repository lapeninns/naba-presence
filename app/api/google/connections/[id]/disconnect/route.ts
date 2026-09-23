import type { TransactionSql } from "postgres"

import {
  disconnectParamsSchema,
  type DisconnectResponse,
} from "@/lib/contracts/connections"
import { updateGoogleNotificationSetting } from "@/lib/server/google"
import { disconnect } from "@/lib/server/google/connections"
import { writePublishAttemptEvent } from "@/lib/server/publishing"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// One mutation per Google account, each with its own timeout and pacing.
export const maxDuration = 60

/**
 * A publish attempt that the disconnect strands: once the connection is gone
 * every readback 404s, so the runner can never resolve it either way.
 */
type StrandedAttempt = {
  id: string
  replyId: string
  reviewId: string
  replyStatus: string
  workflowStatus: string
}

export const POST = route({
  roles: ["owner", "admin"],
  params: disconnectParamsSchema,
  handler: async ({ session, params, requestId, clientRequestId }) => {
    // The connection service owns the ordering (local removal first and
    // authoritative, then Google's notification cleanup, then the revoke).
    // This route adds only what is its own: the publish attempts the
    // disconnect strands, settled in the same transaction.
    const outcome = await disconnect({
      organisationId: session.organisationId,
      userId: session.userId,
      connectionId: params.id,
      requestId,
      clientRequestId,
      withinDisconnect: async (sql) => ({
        publishAttemptsSettled: await settleStrandedAttempts(sql, {
          organisationId: session.organisationId,
          connectionId: params.id,
        }),
      }),
      clearNotifications: (accessToken, accountName) =>
        updateGoogleNotificationSetting(accessToken, accountName, "", [], {
          connectionKey: params.id,
        }),
    })
    return {
      status: "disconnected",
      googleRevocation: outcome.googleRevocation,
    } satisfies DisconnectResponse
  },
})

/**
 * Fail the attempts the disconnect strands, and only those. `started` is left
 * alone: its write may already have landed at Google, and `reclaim_expired_jobs`
 * moves it to `ambiguous` once its lease expires, which is a state this
 * handles. `ambiguous` and `retryable` can never be resolved again, because
 * every readback needs the connection that is about to disappear.
 */
async function settleStrandedAttempts(
  sql: TransactionSql,
  input: { organisationId: string; connectionId: string }
): Promise<number> {
  const stranded = await sql<StrandedAttempt[]>`
    select
      pa.id::text as id,
      rr.id::text as "replyId",
      rr.review_id::text as "reviewId",
      rr.publish_status as "replyStatus",
      r.workflow_status as "workflowStatus"
    from publish_attempt pa
    join review_reply rr on rr.id = pa.review_reply_id
    join review r on r.id = rr.review_id
    join external_location e on e.id = r.external_location_id
    where e.google_connection_id = ${input.connectionId}
      and pa.status in ('ambiguous', 'retryable')
  `
  if (!stranded.length) return 0
  // The runner holds no lock between reading an attempt and settling it, so
  // one it claimed before this transaction started can commit a readback
  // between the select above and this update -- which then reads the new row
  // version and would overwrite a 'succeeded' attempt with 'failed'. The
  // status filter makes the update settle only what is still unresolvable,
  // and everything below follows what it actually settled.
  const settled = await sql<{ id: string }[]>`
    update publish_attempt
    set
      status = 'failed',
      provider_error_code = 'connection_disconnected',
      next_attempt_at = null,
      lease_expires_at = null,
      finished_at = now()
    where id in ${sql(stranded.map((attempt) => attempt.id))}
      and status in ('ambiguous', 'retryable')
    returning id::text as id
  `
  if (!settled.length) return 0
  const settledIds = new Set(settled.map((row) => row.id))
  const settledAttempts = stranded.filter((attempt) =>
    settledIds.has(attempt.id)
  )
  for (const attempt of settledAttempts) {
    await writePublishAttemptEvent(sql, {
      organisationId: input.organisationId,
      publishAttemptId: attempt.id,
      eventType: "completed",
      payload: { code: "connection_disconnected" },
    })
  }
  // A reply that was mid-publish can never land now. One that is already
  // `published` (a delete that never confirmed) must keep saying so: that
  // reply is still live at Google and the local row would start lying.
  const pendingReplies = [
    ...new Set(
      settledAttempts
        .filter((attempt) => attempt.replyStatus === "accepted")
        .map((attempt) => attempt.replyId)
    ),
  ]
  if (pendingReplies.length) {
    await sql`
      update review_reply
      set publish_status = 'failed'
      where id in ${sql(pendingReplies)}
        and publish_status = 'accepted'
    `
  }
  // enforce_review_workflow_transition only allows 'failed' out of
  // 'publish_requested', so any review in another state stays where it is.
  const stuckReviews = [
    ...new Set(
      settledAttempts
        .filter((attempt) => attempt.workflowStatus === "publish_requested")
        .map((attempt) => attempt.reviewId)
    ),
  ]
  if (stuckReviews.length) {
    await sql`
      update review
      set workflow_status = 'failed'
      where id in ${sql(stuckReviews)}
        and workflow_status = 'publish_requested'
    `
  }
  return settledAttempts.length
}
