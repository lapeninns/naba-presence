import { z } from "zod"

import {
  googleChangeDecisionSchema,
  type GoogleChangeDecisionResponse,
} from "@/lib/contracts/google-change-watch"
import { decideGoogleChange } from "@/lib/server/google-change-watch-actions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * "Put ours back" (a reviewed change through the existing approval and
 * publish path) or "Accept Google's" (Google's value becomes ours; nothing
 * is sent). Owners and admins who may publish the listing.
 */
export const POST = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ id: z.uuid(), changeId: z.uuid() }),
  body: googleChangeDecisionSchema,
  handler: async ({ session, params, body, requestId }) =>
    (await decideGoogleChange({
      session,
      locationId: params.id,
      changeId: params.changeId,
      action: body.action,
      expectedGoogleHash: body.expectedGoogleHash,
      requestId,
    })) satisfies GoogleChangeDecisionResponse,
})
