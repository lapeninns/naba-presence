import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import { previewBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/** Persists a reviewed target set with each listing's current and proposed value. */
export const POST = route({
  maxDuration,
  body: bulkPreviewRequestSchema,
  // Reads every targeted listing's current value (W3-07).
  limits: ({ session }) => ({
    scope: "bulk_request",
    user: session.userId,
    organisation: session.organisationId,
  }),
  handler: async ({ session, body, requestId }) => ({ operation: await previewBulkOperation(session, body, requestId) }),
})
