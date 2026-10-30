import { z } from "zod"

import {
  googleWatchSettingsInputSchema,
  type GoogleWatchSettingsResponse,
} from "@/lib/contracts/google-change-watch"
import {
  readGoogleWatchSettings,
  updateGoogleWatchSettings,
} from "@/lib/server/google-change-watch"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const params = z.object({ id: z.uuid() })

/** Which fields are watched on Google and who is alerted. DB only. */
export const GET = route({
  params,
  handler: async ({ session, params }) =>
    (await readGoogleWatchSettings(
      session,
      params.id
    )) satisfies GoogleWatchSettingsResponse,
})

/** Owners and admins choose the protected fields and the people alerted. */
export const PUT = route({
  roles: ["owner", "admin"],
  params,
  body: googleWatchSettingsInputSchema,
  handler: async ({ session, params, body, requestId }) =>
    (await updateGoogleWatchSettings({
      session,
      locationId: params.id,
      settings: body,
      requestId,
    })) satisfies GoogleWatchSettingsResponse,
})
