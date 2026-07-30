import { NextResponse } from "next/server"

import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

function maskedEmail(email: unknown) {
  if (typeof email !== "string") return null
  const at = email.indexOf("@")
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***"
}

export async function GET() {
  try {
    const session = await requireSession()
    const connections = await withTenant(
      session.organisationId,
      (sql) => sql`
      select
        id::text as id,
        google_email as "googleEmail",
        status,
        scope,
        notifications_enabled as "notificationsEnabled",
        last_refresh_at as "lastRefreshAt",
        last_error_code as "lastErrorCode",
        exists (
          select 1
          from connection_task ct
          where ct.google_connection_id = google_connection.id
            and ct.task_type = 'reconnect'
            and ct.status = 'open'
        ) as "reconnectRequired",
        created_at as "createdAt"
      from google_connection
      order by created_at desc
    `
    )
    if (session.role === "owner" || session.role === "admin") {
      return NextResponse.json({ connections })
    }
    return NextResponse.json({
      connections: connections.map((connection) => {
        const record = connection as Record<string, unknown>
        const safeConnection = { ...record }
        delete safeConnection.scope
        return {
          ...safeConnection,
          googleEmail: maskedEmail(record.googleEmail),
        }
      }),
    })
  } catch (error) {
    return apiError(error)
  }
}
