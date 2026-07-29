import { NextResponse } from "next/server"
import { z } from "zod"

import { extractMenu } from "@/lib/server/ai"
import { writeAudit } from "@/lib/server/audit"
import { randomToken } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_MENU_BYTES = 15 * 1024 * 1024
const mediaTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/markdown",
])
const extensionMediaTypes: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
}

function mediaTypeOf(file: File) {
  if (mediaTypes.has(file.type)) return file.type
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  return extensionMediaTypes[extension] ?? ""
}

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const menus = await withTenant(
      session.organisationId,
      (sql) => sql`
        select
          m.id::text as id,
          m.location_id::text as "locationId",
          l.name as "locationName",
          m.public_slug as "publicSlug",
          m.name,
          m.source_filename as "sourceFilename",
          m.source_media_type as "sourceMediaType",
          m.source_bytes as "sourceBytes",
          m.currency_code as "currencyCode",
          m.content_json as content,
          m.extraction_model as "extractionModel",
          m.version,
          m.is_published as "isPublished",
          m.published_at as "publishedAt",
          m.updated_at as "updatedAt"
        from menu m
        join location l on l.id = m.location_id
        order by lower(l.name)
      `
    )
    return NextResponse.json({ menus })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const formData = await request.formData()
    const locationId = z.uuid().parse(formData.get("locationId"))
    const file = formData.get("file")
    if (!(file instanceof File)) {
      throw new ApiError(400, "menu_file_required", "Choose a menu file.")
    }
    if (file.size <= 0 || file.size > MAX_MENU_BYTES) {
      throw new ApiError(
        413,
        "menu_file_too_large",
        "Menu files must be no larger than 15 MB."
      )
    }
    const mediaType = mediaTypeOf(file)
    if (!mediaType) {
      throw new ApiError(
        415,
        "menu_file_type_unsupported",
        "Upload a PDF, JPG, PNG, WebP, TXT, or Markdown menu."
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const extracted = await extractMenu({
      filename: file.name,
      mediaType,
      base64: bytes.toString("base64"),
    })
    const correlationId = requestId(request)
    const menu = await withTenant(session.organisationId, async (sql) => {
      const [location] = await sql<{ id: string }[]>`
        select id::text as id
        from location
        where id = ${locationId}
        limit 1
      `
      if (!location) {
        throw new ApiError(404, "location_not_found", "Location not found.")
      }
      const [row] = await sql<{ id: string }[]>`
        insert into menu (
          organisation_id,
          location_id,
          public_slug,
          name,
          source_filename,
          source_media_type,
          source_bytes,
          currency_code,
          content_json,
          extraction_model,
          imported_by
        )
        values (
          ${session.organisationId},
          ${locationId},
          ${randomToken(15)},
          ${extracted.menuName},
          ${file.name},
          ${mediaType},
          ${file.size},
          ${extracted.currencyCode},
          ${sql.json(JSON.parse(JSON.stringify(extracted)))},
          ${getServerEnv().OPENAI_MODEL_MENU_EXTRACT},
          ${session.userId}
        )
        on conflict (organisation_id, location_id) do update
        set
          name = excluded.name,
          source_filename = excluded.source_filename,
          source_media_type = excluded.source_media_type,
          source_bytes = excluded.source_bytes,
          currency_code = excluded.currency_code,
          content_json = excluded.content_json,
          extraction_model = excluded.extraction_model,
          imported_by = excluded.imported_by,
          version = menu.version + 1,
          is_published = false,
          published_at = null
        returning id::text as id
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "menu.imported",
        subjectType: "menu",
        subjectId: row.id,
        requestId: correlationId,
        metadata: {
          locationId,
          filename: file.name,
          mediaType,
          sourceBytes: file.size,
          categoryCount: extracted.categories.length,
          itemCount: extracted.categories.reduce(
            (total, category) => total + category.items.length,
            0
          ),
        },
      })
      return row
    })
    return NextResponse.json({ menuId: menu.id }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
