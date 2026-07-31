import { NextResponse } from "next/server"
import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES } from "@/lib/domain/google-contract"
import { apiError, serverRequestId } from "@/lib/server/http"
import { removeMedia, updateMedia } from "@/lib/server/media"
import { requireSession } from "@/lib/server/session"

const updateSchema = z.object({ category: z.enum(GOOGLE_MEDIA_CATEGORIES), expectedGoogleHash: z.string().length(64), confirmation: z.literal("update_google_media") })
const deleteSchema = z.object({ expectedGoogleHash: z.string().length(64), confirmation: z.literal("delete_google_media") })

export async function PATCH(request: Request, context: { params: Promise<{ id: string; mediaId: string }> }) {
  try {
    const rid = serverRequestId(request); const session = await requireSession()
    const { id, mediaId } = await context.params; const input = updateSchema.parse(await request.json())
    return NextResponse.json(await updateMedia({ organisationId: session.organisationId, session, locationId: id, mediaId, category: input.category, expectedGoogleHash: input.expectedGoogleHash, requestId: rid.id }))
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; mediaId: string }> }) {
  try {
    const rid = serverRequestId(request); const session = await requireSession()
    const { id, mediaId } = await context.params; const input = deleteSchema.parse(await request.json())
    return NextResponse.json(await removeMedia({ organisationId: session.organisationId, session, locationId: id, mediaId, expectedGoogleHash: input.expectedGoogleHash, requestId: rid.id }))
  } catch (error) { return apiError(error) }
}
