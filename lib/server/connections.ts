import "server-only"

import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

export type ConnectionSummary = {
  id: string
  googleEmail: string | null
  status: string
  scope?: string
  notificationsEnabled: boolean
  lastRefreshAt: string | null
  lastErrorCode: string | null
  reconnectRequired: boolean
  createdAt: string
}

function maskedEmail(email: unknown) {
  if (typeof email !== "string") return null
  const at = email.indexOf("@")
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***"
}

export async function listConnections(
  session: Session
): Promise<ConnectionSummary[]> {
  const connections = await withTenant(
    session.organisationId,
    (sql) => sql<ConnectionSummary[]>`
      select
        id::text as id,
        google_email as "googleEmail",
        status,
        scope,
        notifications_enabled as "notificationsEnabled",
        last_refresh_at::text as "lastRefreshAt",
        last_error_code as "lastErrorCode",
        exists (
          select 1
          from connection_task ct
          where ct.google_connection_id = google_connection.id
            and ct.task_type = 'reconnect'
            and ct.status = 'open'
        ) as "reconnectRequired",
        created_at::text as "createdAt"
      from google_connection
      order by created_at desc
    `
  )

  if (session.role === "owner" || session.role === "admin") {
    return connections
  }

  return connections.map((connection) => {
    const record = connection as Record<string, unknown>
    const safeConnection = { ...record }
    delete safeConnection.scope
    return {
      ...safeConnection,
      googleEmail: maskedEmail(record.googleEmail),
    } as ConnectionSummary
  })
}
