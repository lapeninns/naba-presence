import { z } from "zod"

import {
  administrationMatchSchema,
  administrationMutationSchema,
  type AdministrationMatchResponse,
  type AdministrationMutationResult,
  type AdministrationResponse,
} from "@/lib/contracts/location-administration"
import {
  loadLocationAdministration,
  matchGoogleLocations,
  mutateLocationAdministration,
} from "@/lib/server/location-administration"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
      administration: await loadLocationAdministration(session, params.id),
    }) satisfies AdministrationResponse,
})

export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: administrationMatchSchema,
  handler: async ({ session, params, body }) =>
    ({
      matches: await matchGoogleLocations({
        session,
        locationId: params.id,
        location: body.location,
      }),
    }) satisfies AdministrationMatchResponse,
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: administrationMutationSchema,
  handler: ({ session, params, body, requestId }): Promise<AdministrationMutationResult> =>
    mutateLocationAdministration({
      session,
      locationId: params.id,
      operation: body.operation,
      payload: body.payload,
      requestId,
    }),
})
