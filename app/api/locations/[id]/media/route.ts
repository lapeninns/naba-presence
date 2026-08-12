import { NextResponse } from "next/server"
import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES } from "@/lib/domain/google-contract"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  createMedia,
  loadMedia,
  MAX_MEDIA_UPLOAD_BYTES,
  mediaCreateSchema,
  mediaUploadFieldsSchema,
  uploadMedia,
} from "@/lib/server/media"
import { requireSession } from "@/lib/server/session"

const createSchema = mediaCreateSchema.extend({
  confirmation: z.literal("create_google_media"),
})

const mediaListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  refresh: z.literal("1").optional(),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES).optional(),
  ownership: z.enum(["merchant", "customer"]).optional(),
})

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const url = new URL(request.url)
    const query = mediaListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      refresh: url.searchParams.get("refresh") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      ownership: url.searchParams.get("ownership") ?? undefined,
    })
    return NextResponse.json({
      media: await loadMedia(session.organisationId, session, id, {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 12,
        refresh: query.refresh === "1",
        category: query.category,
        ownership: query.ownership,
      }),
    })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id } = await context.params
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData()
      const file = form.get("file")
      if (!(file instanceof File)) {
        throw new ApiError(
          400,
          "media_file_required",
          "Choose a photo or video to upload."
        )
      }
      if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
        return NextResponse.json(
          {
            error: {
              code: "media_file_too_large",
              message: "Media uploads cannot exceed 75 MB.",
            },
          },
          { status: 413 }
        )
      }
      const input = mediaUploadFieldsSchema.parse({
        mediaFormat: form.get("mediaFormat"),
        category: form.get("category"),
        description: form.get("description") || undefined,
        confirmation: form.get("confirmation"),
      })
      return NextResponse.json(
        await uploadMedia({
          organisationId: session.organisationId,
          session,
          locationId: id,
          payload: input,
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
            bytes: await file.arrayBuffer(),
          },
          requestId: rid.id,
        }),
        { status: 201 }
      )
    }
    const input = createSchema.parse(await request.json())
    return NextResponse.json(await createMedia({
      organisationId: session.organisationId,
      session,
      locationId: id,
      payload: { mediaFormat: input.mediaFormat, category: input.category, sourceUrl: input.sourceUrl, description: input.description },
      requestId: rid.id,
    }), { status: 201 })
  } catch (error) { return apiError(error) }
}
