import { z } from "zod"

import { administrationMutationSchema } from "@/lib/locations/forms/administration"
import {
  loadLocationAdministration,
  matchGoogleLocations,
  mutateLocationAdministration,
} from "@/lib/server/location-administration"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

const matchSchema = z.object({
  operation: z.literal("match_location"),
  location: z.record(z.string(), z.unknown()),
})

export const GET = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  handler: async ({ session, params }) => ({
    administration: await loadLocationAdministration(session, params.id),
  }),
})

export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: matchSchema,
  handler: async ({ session, params, body }) => ({
    matches: await matchGoogleLocations({
      session,
      locationId: params.id,
      location: body.location,
    }),
  }),
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: administrationMutationSchema,
  handler: ({ session, params, body, requestId }) =>
    mutateLocationAdministration({
      session,
      locationId: params.id,
      operation: body.operation,
      payload: body.payload,
      requestId,
    }),
})
