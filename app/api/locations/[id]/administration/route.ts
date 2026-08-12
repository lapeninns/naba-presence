import { NextResponse } from "next/server"
import { z } from "zod"

import { administrationMutationSchema } from "@/lib/locations/forms/administration"
import {
  loadLocationAdministration,
  matchGoogleLocations,
  mutateLocationAdministration,
} from "@/lib/server/location-administration"
import { apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    return NextResponse.json({
      administration: await loadLocationAdministration(
        session,
        z.uuid().parse(id)
      ),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const input = z
      .object({
        operation: z.literal("match_location"),
        location: z.record(z.string(), z.unknown()),
      })
      .parse(await request.json())
    return NextResponse.json({
      matches: await matchGoogleLocations({
        session,
        locationId: z.uuid().parse(id),
        location: input.location,
      }),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const input = administrationMutationSchema.parse(await request.json())
    return NextResponse.json(
      await mutateLocationAdministration({
        session,
        locationId: z.uuid().parse(id),
        operation: input.operation,
        payload: input.payload,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
