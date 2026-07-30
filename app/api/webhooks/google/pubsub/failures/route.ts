import { NextResponse } from "next/server"

import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const items = await withTenant(session.organisationId, (sql) => sql`
      select
        id::text as id,
        event_type as "eventType",
        status,
        retry_count as "retryCount",
        next_attempt_at as "nextAttemptAt",
        last_error_code as "lastErrorCode",
        received_at as "receivedAt"
      from processed_webhook_event
      where status in ('failed', 'dead')
      order by received_at desc, id desc
      limit 100
    `)
    return NextResponse.json({ items })
  } catch (error) {
    return apiError(error)
  }
}
