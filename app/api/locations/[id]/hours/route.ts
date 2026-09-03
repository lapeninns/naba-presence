import { z } from "zod"

import {
  publishHoursBodySchema,
  saveHoursBodySchema,
  type HoursResponse,
  type PublishHoursResponse,
  type SaveHoursResponse,
} from "@/lib/contracts/location-hours"
import {
  getHoursState,
  publishCanonicalHours,
  saveCanonicalHours,
} from "@/lib/server/hours"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The publish POST does a live Google read, a validateOnly PATCH, the real
// PATCH and a read-back; the platform default would cut it off mid-write.
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({ hours: await getHoursState(session, params.id) }) satisfies HoursResponse,
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveHoursBodySchema,
  handler: async ({ session, params, body, requestId }) =>
    (await saveCanonicalHours({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      hours: body.hours,
      requestId,
    })) satisfies SaveHoursResponse,
})

export const POST = route({
  params: paramsSchema,
  body: publishHoursBodySchema,
  handler: async ({ session, params, body, requestId }) =>
    (await publishCanonicalHours({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      expectedCanonicalHash: body.expectedCanonicalHash,
      expectedGoogleHash: body.expectedGoogleHash,
      approvedUpdateMask: body.approvedUpdateMask,
      confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
      requestId,
    })) satisfies PublishHoursResponse,
})
