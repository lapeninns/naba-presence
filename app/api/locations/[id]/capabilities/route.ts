import { NextResponse } from "next/server"
import { z } from "zod"

import { locationCapabilities } from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const capabilities = await withTenant(session.organisationId, (sql) =>
      locationCapabilities(sql, session, locationId)
    )
    return NextResponse.json({ capabilities })
  } catch (error) {
    return apiError(error)
  }
}
