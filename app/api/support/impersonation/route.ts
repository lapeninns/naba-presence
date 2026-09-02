import { timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import {
  clearSession,
  createSession,
  setSessionCookie,
} from "@/lib/server/session"

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

// Support staff authenticate with SUPPORT_IMPERSONATION_SECRET rather than a
// session or the cron token, so the route is "public" and runs its own check
// first. The body is parsed inside the handler (not via the wrapper) so the
// secret is verified before any request content is inspected, as before.
export const POST = route({
  auth: "public",
  handler: async ({ request, requestId, clientRequestId }) => {
    const support = authenticateSupport(request)
    const input = inputSchema.parse(await request.json())
    // The tenant is the impersonation target named in the body, not a
    // session organisation, so withTenant is called directly.
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
        requestId,
        metadata: {
          supportActor: support.actor,
          reason: support.reason,
          expiresWithinMinutes: 60,
          clientRequestId,
        },
      })
      return sessionToken
    })
    await setSessionCookie(token)
    return { impersonating: true, expiresWithinMinutes: 60 }
  },
})

// Ending an impersonation was previously only possible by waiting out the
// one-hour expiry, which left the free-text reason and the elevated session
// alive for the whole window. The caller is whoever holds the impersonated
// cookie, so this needs no support credential - it can only end the session
// presenting it.
export const DELETE = route({
  handler: async ({ session, requestId, clientRequestId, tenant }) => {
    if (!session.supportActor) {
      throw new ApiError(
        409,
        "not_impersonating",
        "This session is not a support impersonation session."
      )
    }
    await tenant(async (sql) => {
      await writeAudit(sql, {
        organisationId: session.organisationId,
        action: "support.impersonation.ended",
        subjectType: "user",
        subjectId: session.userId,
        requestId,
        metadata: {
          supportActor: session.supportActor,
          reason: session.impersonationReason,
          clientRequestId,
        },
      })
    })
    await clearSession()
    return { impersonating: false }
  },
})
