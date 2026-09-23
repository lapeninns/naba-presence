import "server-only"

import type { ConnectionSummary } from "@/lib/contracts/connections"
import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

export type { ConnectionSummary }

// The row shape as postgres.js actually returns it: `timestamptz` columns
// (no `::text` cast) parse to `Date` instances, not strings. See
// `ConnectionSummary` in `lib/contracts/connections` for the normalised
// shape callers receive.
type ConnectionRow = {
  id: string
  googleEmail: string | null
  status: string
  scope: string
  notificationsEnabled: boolean
  lastRefreshAt: string | Date | null
  lastErrorCode: string | null
  refreshTokenExpiresAt: string | Date | null
  reconnectRequired: boolean
  createdAt: string | Date
}

function maskedEmail(email: unknown) {
  if (typeof email !== "string") return null
  const at = email.indexOf("@")
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***"
}

export async function listConnections(
  session: Session
): Promise<ConnectionSummary[]> {
  const rows = await withTenant(
    session.organisationId,
    (sql) => sql<ConnectionRow[]>`
      select
        id::text as id,
        google_email as "googleEmail",
        status,
        scope,
        notifications_enabled as "notificationsEnabled",
        last_refresh_at as "lastRefreshAt",
        last_error_code as "lastErrorCode",
        refresh_token_expires_at as "refreshTokenExpiresAt",
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

  // Normalise to ISO 8601 strings here, once, in TypeScript — NOT via a
  // `::text` SQL cast. A Postgres-formatted text cast ("2026-01-01
  // 12:00:00+00") is a different wire format from `Date#toJSON()`'s ISO
  // 8601 ("2026-01-01T12:00:00.000Z"), which is what this endpoint
  // returned before the rebuild (postgres.js parses timestamptz to `Date`
  // -> `NextResponse.json` -> implicit `.toISOString()`) and what every
  // sibling endpoint still emits. Doing the conversion here — before the
  // RSC-prefetch path (a direct function call, never JSON-serialised) and
  // the HTTP path diverge — is what makes both emit the identical,
  // pre-rebuild ISO string instead of just being identical to each other
  // in some other, wrong, format.
  const connections: ConnectionSummary[] = rows.map((row) => ({
    ...row,
    lastRefreshAt: row.lastRefreshAt
      ? new Date(row.lastRefreshAt as string | Date).toISOString()
      : null,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt
      ? new Date(row.refreshTokenExpiresAt as string | Date).toISOString()
      : null,
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
  }))

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
