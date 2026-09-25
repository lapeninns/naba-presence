import {
  sessionSwitchSchema,
  type SessionResponse,
} from "@/lib/contracts/session"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import { setSessionCookie, type Session } from "@/lib/server/session"
import { createSession } from "@/lib/server/session-store"

export const runtime = "nodejs"

/**
 * Switching organisations legitimately touches two tenants, so the route
 * runs two tenant transactions instead of one hand-rolled `set_config` block:
 *
 *   1. inside the target organisation: verify the membership, create the new
 *      session, load its projection and write the audit row;
 *   2. inside the current organisation: delete the session being replaced
 *      (`app_session` RLS only exposes rows of the active tenant).
 *
 * The order is deliberate: if step 2 fails the caller keeps a working session
 * and the unreferenced new row simply expires, whereas the reverse order could
 * sign the user out on a transient failure.
 *
 * A support impersonation session may not switch. `createSession` here mints
 * an ordinary session, so a switch would drop the support actor (audit
 * attribution), the one-hour limit and the sign-out-everywhere guard from
 * migration 0055. Support starts a new impersonation for the other
 * organisation instead.
 */
export const POST = route({
  body: sessionSwitchSchema,
  handler: async ({
    session: current,
    body,
    requestId,
    clientRequestId,
  }) => {
    if (current.supportActor) {
      throw new ApiError(
        403,
        "support_session_forbidden",
        "A support session cannot switch organisation. Start a new impersonation instead."
      )
    }
    const switched = await withTenant(body.organisationId, async (sql) => {
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
        (item) => item.organisationId === body.organisationId
      )
      if (!membership) {
        throw new ApiError(
          403,
          "organisation_membership_required",
          "You are not a member of that organisation."
        )
      }
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
        requestId,
        metadata: {
          previousOrganisationId: current.organisationId,
          clientRequestId,
        },
      })
      return { session, token }
    })
    await withTenant(current.organisationId, async (sql) => {
      await sql`
        delete from app_session where id = ${current.sessionId}
      `
    })
    await setSessionCookie(switched.token)
    return { session: switched.session } satisfies SessionResponse
  },
})
