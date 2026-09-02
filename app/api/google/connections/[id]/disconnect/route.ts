import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import {
  connectionAccessToken,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  roles: ["owner", "admin"],
  params: z.object({ id: z.string() }),
  handler: async ({ session, params, requestId, clientRequestId, tenant }) => {
    const { id } = params
    await tenant(async (sql) => {
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
              "",
              [],
              { connectionKey: id }
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
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "google.connection.disconnected",
        subjectType: "google_connection",
        subjectId: id,
        requestId,
        metadata: {
          purgeDueWithinDays: 7,
          notificationCleanupErrors: cleanupErrors,
          routesRemoved: removedRoutes.length,
          clientRequestId,
        },
      })
    })
    return { status: "disconnected" }
  },
})
