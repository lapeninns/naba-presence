import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  action: z.string().trim().max(120).optional(),
  pageSize: z.number().int().min(1).max(1000).default(200),
  cursor: z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).optional(),
})

function decodeCursor(value: string | null) {
  if (!value) return undefined
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replaceAll('"', '""')}"`
}

export async function GET(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const params = new URL(request.url).searchParams
    const query = querySchema.parse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      action: params.get("action") ?? undefined,
      pageSize: params.get("page_size")
        ? Number(params.get("page_size"))
        : undefined,
      cursor: decodeCursor(params.get("cursor")),
    })
    const rows = await withTenant(session.organisationId, async (sql) => {
      const records = await sql`
        select
          a.id::text as id,
          a.action,
          a.subject_type as "subjectType",
          a.subject_id as "subjectId",
          a.actor_user_id::text as "actorUserId",
          u.email as "actorEmail",
          a.request_id as "requestId",
          a.metadata,
          a.created_at as "createdAt"
        from audit_log a
        left join app_user u on u.id = a.actor_user_id
        where 1 = 1
          ${query.from ? sql`and a.created_at >= ${query.from}` : sql``}
          ${query.to ? sql`and a.created_at <= ${query.to}` : sql``}
          ${query.action ? sql`and a.action = ${query.action}` : sql``}
          ${
            query.cursor
              ? sql`and (a.created_at, a.id) < (
                  ${query.cursor.createdAt},
                  ${query.cursor.id}
                )`
              : sql``
          }
        order by a.created_at desc, a.id desc
        limit ${query.pageSize + 1}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "audit.exported",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId: rid.id,
        metadata: {
          from: query.from ?? null,
          to: query.to ?? null,
          action: query.action ?? null,
          format: params.get("format") === "csv" ? "csv" : "json",
          records: Math.min(records.length, query.pageSize),
          clientRequestId: rid.clientId,
        },
      })
      return records
    })
    const hasMore = rows.length > query.pageSize
    const items = hasMore ? rows.slice(0, query.pageSize) : rows
    const last = items.at(-1) as
      { id: string; createdAt: Date | string } | undefined
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt:
                last.createdAt instanceof Date
                  ? last.createdAt.toISOString()
                  : last.createdAt,
              id: last.id,
            })
          ).toString("base64url")
        : null
    if (params.get("format") === "csv") {
      const header = [
        "id",
        "created_at",
        "action",
        "subject_type",
        "subject_id",
        "actor_user_id",
        "actor_email",
        "request_id",
        "metadata",
      ]
      const lines = items.map((item) => {
        const row = item as Record<string, unknown>
        return [
          row.id,
          row.createdAt,
          row.action,
          row.subjectType,
          row.subjectId,
          row.actorUserId,
          row.actorEmail,
          row.requestId,
          row.metadata,
        ]
          .map(csvCell)
          .join(",")
      })
      return new NextResponse([header.join(","), ...lines].join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="audit-log.csv"',
          "cache-control": "private, no-store",
        },
      })
    }
    return NextResponse.json(
      { items, nextCursor },
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    return apiError(error)
  }
}
