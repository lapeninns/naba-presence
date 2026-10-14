import { z } from "zod"

import type { ListingChangeListResponse } from "@/lib/contracts/listing-changes"
import { listListingChanges } from "@/lib/server/listing-changes"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

/**
 * The listing changes at this location waiting for a second publisher's
 * approval (two-person mode, lib/server/listing-changes.ts). Anyone who can
 * see the location sees them; `canDecide` says who may decide.
 */
export const GET = route({
  maxDuration,
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
      changeRequests: await listListingChanges(session, params.id),
    }) satisfies ListingChangeListResponse,
})
