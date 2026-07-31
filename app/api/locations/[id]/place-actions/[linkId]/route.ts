import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, serverRequestId } from "@/lib/server/http"
import {
  placeActionInputSchema,
  removePlaceAction,
  updatePlaceAction,
} from "@/lib/server/place-actions"
import { requireSession } from "@/lib/server/session"

const updateSchema = placeActionInputSchema.extend({
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("update_google_place_action"),
})

const deleteSchema = z.object({
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("delete_google_place_action"),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, linkId } = await context.params
    const input = updateSchema.parse(await request.json())
    const expectedGoogleHash = input.expectedGoogleHash
    const payload = {
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    }
    return NextResponse.json(
      await updatePlaceAction({
        organisationId: session.organisationId,
        session,
        locationId: id,
        linkId,
        payload,
        expectedGoogleHash,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, linkId } = await context.params
    const input = deleteSchema.parse(await request.json())
    return NextResponse.json(
      await removePlaceAction({
        organisationId: session.organisationId,
        session,
        locationId: id,
        linkId,
        expectedGoogleHash: input.expectedGoogleHash,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
