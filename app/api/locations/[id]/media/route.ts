import { NextResponse } from "next/server"
import { z } from "zod"

import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaCreateRequestSchema,
  mediaListQuerySchema,
  mediaUploadFieldsSchema,
  type MediaListResponseWire,
  type MediaMutationOutcome,
} from "@/lib/contracts/location-media"
import { ApiError } from "@/lib/server/http"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { refuseUploadWhenApprovalRequired } from "@/lib/server/listing-changes"
import { loadMedia, uploadMedia } from "@/lib/server/media"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string() })

export const runtime = "nodejs"
export const maxDuration = 60

export const GET = route({
  params: paramsSchema,
  query: mediaListQuerySchema,
  handler: async ({ session, params, query }) =>
    ({
      media: await loadMedia(session.organisationId, session, params.id, {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 12,
        refresh: query.refresh === "1",
        category: query.category,
        ownership: query.ownership,
      }),
    }) satisfies MediaListResponseWire,
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
      // An upload cannot be frozen for approval; refused, not sent, while
      // two-person listing approval applies.
      await refuseUploadWhenApprovalRequired(session, params.id)
      const input = mediaUploadFieldsSchema.parse({
        mediaFormat: form.get("mediaFormat"),
        category: form.get("category"),
        description: form.get("description") || undefined,
        confirmation: form.get("confirmation"),
      })
      return NextResponse.json(
        (await uploadMedia({
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
        })) satisfies MediaMutationOutcome,
        { status: 201 }
      )
    }
    const input = mediaCreateRequestSchema.parse(await request.json())
    // Parks for a second publisher in two-person mode (a 202);
    // lib/server/listing-change-registry.ts.
    const created = await submitListingChange("media_create", {
      session,
      locationId: params.id,
      body: input,
      requestId,
    })
    if (created instanceof Response) return created
    return NextResponse.json(created satisfies MediaMutationOutcome, {
      status: 201,
    })
  },
})
