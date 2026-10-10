import { z } from "zod"

import {
  publishHoursBodySchema,
  saveHoursBodySchema,
  type HoursResponse,
  type PublishHoursResponse,
  type SaveHoursResponse,
} from "@/lib/contracts/location-hours"
import { getHoursState, saveCanonicalHours } from "@/lib/server/hours"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { invalidatePendingListingChanges } from "@/lib/server/listing-changes"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The publish POST does a live Google read, a validateOnly PATCH, the real
// PATCH and a read-back; the platform default would cut it off mid-write.
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
      hours: await getHoursState(session, params.id),
    }) satisfies HoursResponse,
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveHoursBodySchema,
  handler: async ({ session, params, body, requestId }) => {
    const saved = (await saveCanonicalHours({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      hours: body.hours,
      requestId,
    })) satisfies SaveHoursResponse
    // A publish waiting for approval was for the hours before this save.
    await invalidatePendingListingChanges({
      organisationId: session.organisationId,
      locationId: params.id,
      kinds: ["hours_publish"],
    })
    return saved
  },
})

export const POST = route({
  params: paramsSchema,
  body: publishHoursBodySchema,
  // Parks for a second publisher in two-person mode
  // (lib/server/listing-change-registry.ts); sent as before otherwise.
  handler: async ({ session, params, body, requestId }) =>
    (await submitListingChange("hours_publish", {
      session,
      locationId: params.id,
      body,
      requestId,
    })) satisfies PublishHoursResponse | Response,
})
