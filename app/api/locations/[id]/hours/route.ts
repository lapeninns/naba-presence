import { z } from "zod"

import { editorRefreshQuerySchema } from "@/lib/contracts/editor-freshness"
import {
  publishHoursBodySchema,
  saveHoursBodySchema,
  type PublishHoursResponse,
  type SaveHoursResponse,
} from "@/lib/contracts/location-hours"
import { saveCanonicalHours } from "@/lib/server/hours"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { invalidatePendingListingChanges } from "@/lib/server/listing-changes"
import { readHoursResponse } from "@/lib/server/listing-reads"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The publish POST does a live Google read, a validateOnly PATCH, the real
// PATCH and a read-back; the platform default would cut it off mid-write.
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

// The read lives in lib/server/listing-reads.ts so the hours page's streamed
// server prefetch produces exactly what this route answers.
// `?refresh=1` reads Google past the editor's staleness budget.
export const GET = route({
  params: paramsSchema,
  query: editorRefreshQuerySchema,
  handler: ({ session, params, query }) =>
    readHoursResponse(session, params.id, { refresh: query.refresh === "1" }),
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
  mfa: "step_up",
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
