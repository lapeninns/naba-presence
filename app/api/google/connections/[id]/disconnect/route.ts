import { NextResponse } from "next/server"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import {
  connectionAccessToken,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await context.params
    await withTenant(session.organisationId, async (sql) => {
      const [connection] = await sql<
        {
          id: string
          notifications_enabled: boolean
        }[]
      >`
        select id::text as id, notifications_enabled
        from google_connection
        where id = ${id}
          and status <> 'disconnected'
        limit 1
      `
      if (!connection) {
        throw new ApiError(404, "connection_not_found", "Connection not found.")
      }
      const cleanupErrors: string[] = []
      if (connection.notifications_enabled) {
        try {
          const accessToken = await connectionAccessToken(sql, id)
          const accounts = await sql<{ google_account_name: string }[]>`
            select google_account_name
            from google_account
            where google_connection_id = ${id}
          `
          for (const account of accounts) {
            await updateGoogleNotificationSetting(
              accessToken,
              account.google_account_name,
              ""
            )
          }
        } catch (error) {
          cleanupErrors.push(
            error instanceof ApiError
              ? error.code
              : "notification_cleanup_failed"
          )
        }
      }
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
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "google.connection.disconnected",
        subjectType: "google_connection",
        subjectId: id,
        requestId: requestId(request),
        metadata: {
          purgeDueWithinDays: 7,
          notificationCleanupErrors: cleanupErrors,
        },
      })
    })
    return NextResponse.json({ status: "disconnected" })
  } catch (error) {
    return apiError(error)
  }
}
