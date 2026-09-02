import { NextResponse } from "next/server"
import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES } from "@/lib/domain/google-contract"
import { ApiError } from "@/lib/server/http"
import {
  createMedia,
  loadMedia,
  MAX_MEDIA_UPLOAD_BYTES,
  mediaCreateSchema,
  mediaUploadFieldsSchema,
  uploadMedia,
} from "@/lib/server/media"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string() })

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

export const GET = route({
  params: paramsSchema,
  query: mediaListQuerySchema,
  handler: async ({ session, params, query }) => ({
    media: await loadMedia(session.organisationId, session, params.id, {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 12,
      refresh: query.refresh === "1",
      category: query.category,
      ownership: query.ownership,
    }),
  }),
})

// The upload branch is multipart/form-data, so the body is read from the
// request directly here rather than through a `body` schema; the JSON
// create branch parses its own body for the same reason.
export const POST = route({
  params: paramsSchema,
  handler: async ({ request, session, params, requestId }) => {
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
          locationId: params.id,
          payload: input,
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
            bytes: await file.arrayBuffer(),
          },
          requestId,
        }),
        { status: 201 }
      )
    }
    const input = createSchema.parse(await request.json())
    return NextResponse.json(
      await createMedia({
        organisationId: session.organisationId,
        session,
        locationId: params.id,
        payload: {
          mediaFormat: input.mediaFormat,
          category: input.category,
          sourceUrl: input.sourceUrl,
          description: input.description,
        },
        requestId,
      }),
      { status: 201 }
    )
  },
})
