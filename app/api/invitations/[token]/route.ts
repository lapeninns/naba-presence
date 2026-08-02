import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { ApiError, apiError } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const [invitation] = await getDatabase()<
      {
        organisationName: string
        email: string
        expiresAt: Date
        acceptedAt: Date | null
      }[]
    >`
      select
        organisation_name as "organisationName",
        email,
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from lookup_invitation(${sha256(token)})
    `
    if (!invitation) {
      throw new ApiError(
        404,
        "invitation_not_found",
        "Invitation not found."
      )
    }
    const accepted = invitation.acceptedAt !== null
    return NextResponse.json({
      organisationName: invitation.organisationName,
      email: invitation.email,
      accepted,
      expired: !accepted && invitation.expiresAt.getTime() <= Date.now(),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { token } = await context.params
    const invitationId = z.uuid().parse(token)
    await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        delete from invitation
        where id = ${invitationId}
          and accepted_at is null
        returning id::text as id
      `
      if (!row) {
        throw new ApiError(404, "invitation_not_found", "Invitation not found.")
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.invitation_revoked",
        subjectType: "invitation",
        subjectId: invitationId,
      })
    })
    return NextResponse.json({ revoked: true })
  } catch (error) {
    return apiError(error)
  }
}
