import { z } from "zod"

import {
  mediaResolveRequestSchema,
  type MediaMutationOutcome,
} from "@/lib/contracts/location-media"
import { resolveMediaCreate } from "@/lib/server/media"
import { route } from "@/lib/server/route"

export const maxDuration = 60

const paramsSchema = z.object({ id: z.string(), attemptId: z.uuid() })

// A person's verdict on a create Google never confirmed
// (lib/server/media.ts resolveMediaCreate). Nothing is sent to Google.
export const POST = route({
  maxDuration,
  params: paramsSchema,
  body: mediaResolveRequestSchema,
  handler: async ({ session, params, body, requestId }) =>
    (await resolveMediaCreate({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      attemptId: params.attemptId,
      resolution: body.resolution,
      requestId,
    })) satisfies MediaMutationOutcome,
})
