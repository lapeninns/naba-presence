import { NextResponse } from "next/server"

import type { SessionResponse } from "@/lib/contracts/session"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { route } from "@/lib/server/route"
import {
  clearSession,
  dropSessionCookie,
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
//
// The answer is truthful: 204 only when what was asked for happened. When
// revoking every session fails, this browser is still signed out (its own
// row is deleted when the database allows, and its cookie always is) and
// the route answers 503 `sign_out_everywhere_failed`, so the client can say
// other devices may still be signed in rather than claim they are not.
export const DELETE = route({
  auth: "public",
  origin: "same",
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
    if (!query.everywhere) {
      await clearSession()
      return new NextResponse(null, { status: 204 })
    }
    try {
      await revokeAllSessions()
    } catch (error) {
      log.error("session.revoke_all_failed", { requestId, error })
      await clearSession().catch((clearError: unknown) => {
        log.error("session.clear_after_revoke_failed", {
          requestId,
          error: clearError,
        })
      })
      await dropSessionCookie()
      throw new ApiError(
        503,
        "sign_out_everywhere_failed",
        "Signed out on this device only. Other sessions may still be active."
      )
    }
    return new NextResponse(null, { status: 204 })
  },
})
