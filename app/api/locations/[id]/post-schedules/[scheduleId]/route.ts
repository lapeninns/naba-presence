import { z } from "zod"

import {
  scheduleActionSchema,
  scheduleRevisionSchema,
} from "@/lib/contracts/publication-schedules"
import { assertRouteEntitled } from "@/lib/server/entitlement-policy"
import { requireRecentMfa } from "@/lib/server/mfa"
import {
  actOnPublicationSchedule,
  revisePublicationSchedule,
} from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid(), scheduleId: z.uuid() })

/** A material edit or reschedule: a new revision that needs approval again. */
export const PUT = route({
  params,
  body: scheduleRevisionSchema,
  handler: async ({ session, params, body, requestId }) => ({
    schedule: await revisePublicationSchedule(
      session,
      params.id,
      params.scheduleId,
      body,
      requestId
    ),
  }),
})
/**
 * Pause, resume or cancel: an owner or administrator's call. Pausing and
 * cancelling stop queued work, so they stay available at aal1 and while the
 * organisation is read-only (ENTITLEMENT_EXEMPT_ROUTES). Resuming re-arms an
 * approved publication, like retrying a bulk batch (POST
 * listings/bulk/[id]/retry), so it is held to the same rules here: a recent
 * two-step verification, then paid access, in route()'s order.
 */
export const PATCH = route({
  entitlement: "exempt",
  roles: ["owner", "admin"],
  params,
  body: scheduleActionSchema,
  handler: async ({ session, params, body, requestId }) => {
    if (body.action === "resume") {
      requireRecentMfa(session)
      assertRouteEntitled(session, "write")
    }
    return {
      schedule: await actOnPublicationSchedule(
        session,
        params.id,
        params.scheduleId,
        body.action,
        requestId
      ),
    }
  },
})
