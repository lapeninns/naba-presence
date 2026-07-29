import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { createSession, setSessionCookie } from "@/lib/server/session"

export const runtime = "nodejs"

const inputSchema = z.object({
  organisationId: z.uuid(),
  userId: z.uuid(),
})
const reasonSchema = z.string().trim().min(10).max(500)
const actorSchema = z.email()

function authenticateSupport(request: Request) {
  const expected = getServerEnv().SUPPORT_IMPERSONATION_SECRET
  if (!expected) {
    throw new ApiError(
      404,
      "support_impersonation_disabled",
      "Support impersonation is disabled."
    )
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "")
  const left = Buffer.from(provided ?? "")
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ApiError(
      401,
      "invalid_support_credential",
      "Support authentication failed."
    )
  }
  return {
    reason: reasonSchema.parse(request.headers.get("x-support-reason")),
    actor: actorSchema.parse(request.headers.get("x-support-actor")),
  }
}

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const support = authenticateSupport(request)
    const input = inputSchema.parse(await request.json())
    const token = await withTenant(input.organisationId, async (sql) => {
      const [member] = await sql<{ userId: string }[]>`
        select user_id::text as "userId"
        from member
        where user_id = ${input.userId}
        limit 1
      `
      if (!member) {
        throw new ApiError(
          404,
          "support_target_not_found",
          "The support target was not found."
        )
      }
      const sessionToken = await createSession(
        sql,
        input.userId,
        input.organisationId,
        {
          supportActor: support.actor,
          impersonationReason: support.reason,
          maxAgeDays: 1 / 24,
        }
      )
      await writeAudit(sql, {
        organisationId: input.organisationId,
        action: "support.impersonation.started",
        subjectType: "user",
        subjectId: input.userId,
        requestId: rid.id,
        metadata: {
          supportActor: support.actor,
          reason: support.reason,
          expiresWithinMinutes: 60,
          clientRequestId: rid.clientId,
        },
      })
      return sessionToken
    })
    await setSessionCookie(token)
    return NextResponse.json({ impersonating: true, expiresWithinMinutes: 60 })
  } catch (error) {
    return apiError(error)
  }
}
