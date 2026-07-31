import { NextResponse } from "next/server"
import { z } from "zod"

import {
  loadLocationAdministration,
  matchGoogleLocations,
  mutateLocationAdministration,
} from "@/lib/server/location-administration"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const OPERATIONS = [
  "start_verification", "complete_verification", "create_admin",
  "update_admin", "delete_admin", "accept_invitation",
  "decline_invitation", "transfer_location", "create_location",
  "delete_location", "accept_google_update",
] as const

const CONFIRMATIONS: Record<(typeof OPERATIONS)[number], string> = {
  start_verification: "start_google_location_verification",
  complete_verification: "complete_google_location_verification",
  create_admin: "invite_google_administrator",
  update_admin: "change_google_administrator_role",
  delete_admin: "remove_google_administrator",
  accept_invitation: "accept_google_invitation",
  decline_invitation: "decline_google_invitation",
  transfer_location: "transfer_google_location",
  create_location: "create_google_location",
  delete_location: "delete_google_location_permanently",
  accept_google_update: "accept_google_suggested_update",
}

const mutationSchema = z.object({
  operation: z.enum(OPERATIONS),
  confirmation: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
})

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
    const input = z.object({
      operation: z.literal("match_location"),
      location: z.record(z.string(), z.unknown()),
    }).parse(await request.json())
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
    const input = mutationSchema.parse(await request.json())
    if (input.confirmation !== CONFIRMATIONS[input.operation]) {
      throw new ApiError(
        400,
        "administration_confirmation_invalid",
        "The confirmation does not match the requested Google operation."
      )
    }
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
