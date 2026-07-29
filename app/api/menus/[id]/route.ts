import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const inputSchema = z.object({
  isPublished: z.boolean(),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await context.params
    z.uuid().parse(id)
    const input = inputSchema.parse(await request.json())
    const menu = await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        update menu
        set
          is_published = ${input.isPublished},
          published_at = case
            when ${input.isPublished} then now()
            else null
          end
        where id = ${id}
        returning id::text as id
      `
      if (!row) {
        throw new ApiError(404, "menu_not_found", "Menu not found.")
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: input.isPublished ? "menu.published" : "menu.unpublished",
        subjectType: "menu",
        subjectId: row.id,
        requestId: requestId(request),
      })
      return row
    })
    return NextResponse.json({ menu })
  } catch (error) {
    return apiError(error)
  }
}
