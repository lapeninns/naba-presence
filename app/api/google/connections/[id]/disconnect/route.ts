import type { TransactionSql } from "postgres"

import {
  disconnectParamsSchema,
  type DisconnectResponse,
} from "@/lib/contracts/connections"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase } from "@/lib/server/db"
import {
  connectionAccessToken,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
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
  handler: async ({ session, params, requestId, clientRequestId, tenant }) => {
    const { id } = params
    // Phase 1 - read. Google's notification mutations take up to 20s each and
    // issue no SQL in between, so holding a transaction across them tripped
    // idle_in_transaction_session_timeout and rolled the whole disconnect back.
    const target = await tenant(async (sql) => {
      const [connection] = await sql<{ notificationsEnabled: boolean }[]>`
        select notifications_enabled as "notificationsEnabled"
        from google_connection
        where id = ${id}
          and status <> 'disconnected'
        limit 1
      `
      if (!connection) {
        throw new ApiError(404, "connection_not_found", "Connection not found.")
      }
      const accounts = await sql<{ googleAccountName: string }[]>`
        select google_account_name as "googleAccountName"
        from google_account
        where google_connection_id = ${id}
      `
      return {
        notificationsEnabled: connection.notificationsEnabled,
        accountNames: accounts.map((account) => account.googleAccountName),
      }
    })

    // Phase 2 - the access token, while the credentials still exist. Losing it
    // only costs the notification cleanup: revoking locally is what the user
    // asked for and must not depend on Google answering.
    const cleanupErrors: string[] = []
    let accessToken: string | null = null
    if (target.notificationsEnabled && target.accountNames.length) {
      try {
        accessToken = await connectionAccessToken(
          getDatabase(),
          session.organisationId,
          id
        )
      } catch (error) {
        cleanupErrors.push(
          error instanceof ApiError ? error.code : "notification_cleanup_failed"
        )
      }
    }

    // Phase 3 - revoke, durably, BEFORE any provider mutation. A Google outage
    // can now only leave a stale notificationSetting at Google, never a row
    // the user believes is disconnected but that still holds live tokens.
    const revoked = await tenant(async (sql) => {
      const result = await sql`
        update google_connection
        set
          status = 'disconnected',
          access_token_ciphertext = null,
          refresh_token_ciphertext = null,
          notifications_enabled = false,
          disconnected_at = now(),
          purge_due_at = now() + interval '7 days'
        where id = ${id}
          and status <> 'disconnected'
        returning id
      `
      if (!result.length) {
        throw new ApiError(404, "connection_not_found", "Connection not found.")
      }
      await sql`
        update connection_task
        set status = 'cancelled', resolved_at = now()
        where google_connection_id = ${id}
          and status = 'open'
      `
      await sql`
        update sync_checkpoint
        set
          status = 'cancelled',
          finished_at = now(),
          next_attempt_at = null
        where external_location_id in (
          select id
          from external_location
          where google_connection_id = ${id}
        )
          and status in ('pending', 'running', 'failed')
      `
      const removedRoutes = await sql`
        delete from webhook_route
        where organisation_id = ${session.organisationId}
          and external_location_id in (
            select id
            from external_location
            where google_connection_id = ${id}
          )
        returning google_location_name
      `
      await sql`
        update location_link
        set is_active = false
        where external_location_id in (
          select id
          from external_location
          where google_connection_id = ${id}
        )
      `
      const settledAttempts = await settleStrandedAttempts(sql, {
        organisationId: session.organisationId,
        connectionId: id,
      })
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "google.connection.disconnected",
        subjectType: "google_connection",
        subjectId: id,
        requestId,
        metadata: {
          purgeDueWithinDays: 7,
          routesRemoved: removedRoutes.length,
          publishAttemptsSettled: settledAttempts,
          clientRequestId,
        },
      })
      return { settledAttempts }
    })

    // Phase 4 - clear Google's notification settings, one account at a time so
    // one unreachable account cannot skip every account after it.
    const residualAccounts: string[] = []
    if (accessToken) {
      for (const accountName of target.accountNames) {
        try {
          await updateGoogleNotificationSetting(
            accessToken,
            accountName,
            "",
            [],
            { connectionKey: id }
          )
        } catch (error) {
          residualAccounts.push(accountName)
          cleanupErrors.push(
            error instanceof ApiError
              ? error.code
              : "notification_cleanup_failed"
          )
        }
      }
    }

    // Phase 5 - record what Google would not accept. The connection is already
    // revoked, so this is a residual notificationSetting at Google that an
    // operator has to clear by hand; it needs a durable trace, not a rollback.
    if (cleanupErrors.length) {
      log.warn("google.notification_cleanup_failed", {
        requestId,
        organisationId: session.organisationId,
        connectionId: id,
        residualAccounts: residualAccounts.length,
        errors: cleanupErrors,
      })
      await tenant((sql) =>
        writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "google.notifications.cleanup_failed",
          subjectType: "google_connection",
          subjectId: id,
          requestId,
          metadata: {
            residualAccounts,
            errors: cleanupErrors,
            publishAttemptsSettled: revoked.settledAttempts,
            clientRequestId,
          },
        })
      )
    }
    return { status: "disconnected" } satisfies DisconnectResponse
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
  await sql`
    update publish_attempt
    set
      status = 'failed',
      provider_error_code = 'connection_disconnected',
      next_attempt_at = null,
      lease_expires_at = null,
      finished_at = now()
    where id in ${sql(stranded.map((attempt) => attempt.id))}
  `
  for (const attempt of stranded) {
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
      stranded
        .filter((attempt) => attempt.replyStatus === "accepted")
        .map((attempt) => attempt.replyId)
    ),
  ]
  if (pendingReplies.length) {
    await sql`
      update review_reply
      set publish_status = 'failed'
      where id in ${sql(pendingReplies)}
    `
  }
  // enforce_review_workflow_transition only allows 'failed' out of
  // 'publish_requested', so any review in another state stays where it is.
  const stuckReviews = [
    ...new Set(
      stranded
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
  return stranded.length
}
