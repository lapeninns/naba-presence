import { z } from "zod"

import { finaliseAsset } from "@/lib/server/assets"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Checks the uploaded bytes (type, size, dimensions, SHA-256) and stores
 * them once under the asset's immutable key; a failed check rejects the
 * asset (422).
 */
export const POST = route({
  maxDuration,
  // Viewers cannot add photos (also refused in lib/server/assets.ts).
  roles: ["owner", "admin", "member"],
  params: z.object({ id: z.uuid() }),
  handler: async ({ session, params, requestId }) => ({
    asset: await finaliseAsset(session, params.id, requestId),
  }),
})
