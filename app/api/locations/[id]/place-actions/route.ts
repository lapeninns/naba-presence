import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, serverRequestId } from "@/lib/server/http"
import {
  createPlaceAction,
  loadPlaceActions,
  placeActionInputSchema,
} from "@/lib/server/place-actions"
import { requireSession } from "@/lib/server/session"

const createSchema = placeActionInputSchema.extend({
  confirmation: z.literal("create_google_place_action"),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json({
      placeActions: await loadPlaceActions(
        session.organisationId,
        session,
        id
      ),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id } = await context.params
    const input = createSchema.parse(await request.json())
    const payload = {
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    }
    return NextResponse.json(
      await createPlaceAction({
        organisationId: session.organisationId,
        session,
        locationId: id,
        payload,
        requestId: rid.id,
      }),
      { status: 201 }
    )
  } catch (error) {
    return apiError(error)
  }
}
