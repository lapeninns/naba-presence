import { NextResponse } from "next/server"

import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await requireSession()
    const items = await withTenant(
      session.organisationId,
      (sql) => sql`
        select
          organisation_id::text as "organisationId",
          name,
          role
        from list_user_organisations(${session.userId})
      `
    )
    return NextResponse.json({ items })
  } catch (error) {
    return apiError(error)
  }
}
