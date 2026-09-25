import { NextResponse } from "next/server"

import type { SessionResponse } from "@/lib/contracts/session"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { log } from "@/lib/server/logger"
import { route } from "@/lib/server/route"
import {
  clearSession,
  ensureDevelopmentSession,
  getSession,
  isLocalBootstrapEnabled,
  revokeAllSessions,
} from "@/lib/server/session"

export const runtime = "nodejs"

// Public: this endpoint reports the current session (or null) and, outside
// production, bootstraps the local development session.
export const GET = route({
  auth: "public",
  handler: async () => {
    const session =
      process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
        ? await ensureDevelopmentSession()
        : await getSession()
    return { session } satisfies SessionResponse
  },
})

// Public: signing out must succeed whether or not a valid session exists.
// `?scope=all` signs the person out everywhere (every device, every
// organisation); Google connections and background sync are untouched.
export const DELETE = route({
  auth: "public",
  query: (searchParams) => ({ everywhere: searchParams.get("scope") === "all" }),
  handler: async ({ query, requestId, clientRequestId }) => {
    // Signing out of a support impersonation ends it; record that, as
    // DELETE /api/support/impersonation does, so the trail has an end for
    // every start. Best effort: sign-out must succeed regardless.
    const current = await getSession().catch(() => null)
    if (current?.supportActor) {
      await withTenant(current.organisationId, (sql) =>
        writeAudit(sql, {
          organisationId: current.organisationId,
          action: "support.impersonation.ended",
          subjectType: "user",
          subjectId: current.userId,
          requestId,
          supportActor: current.supportActor,
          impersonationReason: current.impersonationReason,
          metadata: {
            supportActor: current.supportActor,
            reason: current.impersonationReason,
            via: "sign_out",
            clientRequestId,
          },
        })
      ).catch((error: unknown) => {
        log.error("support.impersonation.end_audit_failed", {
          requestId,
          organisationId: current.organisationId,
          error,
        })
      })
    }
    if (query.everywhere) await revokeAllSessions()
    else await clearSession()
    return new NextResponse(null, { status: 204 })
  },
})
