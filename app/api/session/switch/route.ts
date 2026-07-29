import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  requireSession,
  setSessionCookie,
  type Session,
} from "@/lib/server/session"
import { createSession } from "@/lib/server/session-store"

export const runtime = "nodejs"

const inputSchema = z.object({ organisationId: z.uuid() })

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const current = await requireSession()
    const input = inputSchema.parse(await request.json())
    const switched = await getDatabase().begin(async (sql) => {
      await sql`
        select set_config(
          'app.organisation_id',
          ${current.organisationId},
          true
        )
      `
      const memberships = await sql<
        { organisationId: string; name: string; role: Session["role"] }[]
      >`
        select
          organisation_id::text as "organisationId",
          name,
          role
        from list_user_organisations(${current.userId})
      `
      const membership = memberships.find(
        (item) => item.organisationId === input.organisationId
      )
      if (!membership) {
        throw new ApiError(
          403,
          "organisation_membership_required",
          "You are not a member of that organisation."
        )
      }
      await sql`
        delete from app_session where id = ${current.sessionId}
      `
      await sql`
        select set_config(
          'app.organisation_id',
          ${membership.organisationId},
          true
        )
      `
      const token = await createSession(
        sql,
        current.userId,
        membership.organisationId
      )
      const [session] = await sql<Session[]>`
        select
          s.id::text as "sessionId",
          s.user_id::text as "userId",
          s.organisation_id::text as "organisationId",
          o.name as "organisationName",
          u.display_name as "displayName",
          u.email,
          m.role,
          m.can_publish as "canPublish"
        from app_session s
        join app_user u on u.id = s.user_id
        join organisation o on o.id = s.organisation_id
        join member m
          on m.organisation_id = s.organisation_id
         and m.user_id = s.user_id
        where s.token_hash = ${sha256(token)}
      `
      await writeAudit(sql, {
        organisationId: membership.organisationId,
        actorUserId: current.userId,
        action: "session.organisation_switched",
        subjectType: "organisation",
        subjectId: membership.organisationId,
        requestId: rid.id,
        metadata: {
          previousOrganisationId: current.organisationId,
          clientRequestId: rid.clientId,
        },
      })
      return { session, token }
    })
    await setSessionCookie(switched.token)
    return NextResponse.json({ session: switched.session })
  } catch (error) {
    return apiError(error)
  }
}
