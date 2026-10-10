import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import { previewBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/** Persists a reviewed target set with each listing's current and proposed value. */
export const POST = route({
  body: bulkPreviewRequestSchema,
  handler: async ({ session, body, requestId }) => ({ operation: await previewBulkOperation(session, body, requestId) }),
})
