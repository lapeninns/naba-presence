import {
  assetCreateRequestSchema,
  assetListQuerySchema,
} from "@/lib/contracts/assets"
import { createAsset, listAssets } from "@/lib/server/assets"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The organisation's photo assets, newest first (`?status=ready` for the bulk composer). */
export const GET = route({
  query: assetListQuerySchema,
  handler: async ({ session, query }) => ({
    assets: await listAssets(session, query),
  }),
})

/**
 * Starts a photo upload: a staging asset and a signed URL for its bytes,
 * which the browser sends straight to private storage, never through this
 * route (lib/server/assets.ts).
 */
export const POST = route({
  // Viewers cannot add photos (also refused in lib/server/assets.ts).
  roles: ["owner", "admin", "member"],
  body: assetCreateRequestSchema,
  limits: ({ session }) => ({
    scope: "asset_upload",
    user: session.userId,
    organisation: session.organisationId,
  }),
  handler: async ({ session, body, requestId }) =>
    createAsset(session, body, requestId),
})
