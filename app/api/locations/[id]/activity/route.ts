import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError } from "@/lib/server/http"
import { listLocationActivity } from "@/lib/server/location-activity"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const locationId = z.uuid().parse(id)
    const url = new URL(request.url)
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })
    return NextResponse.json({
      activity: await listLocationActivity(
        session.organisationId,
        session,
        locationId,
        query
      ),
    })
  } catch (error) {
    return apiError(error)
  }
}
