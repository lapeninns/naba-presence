import { z } from "zod"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { listAdministrationAccessReviews, previewAdministrationAccess } from "@/lib/server/google-administration-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ reviews: await listAdministrationAccessReviews(session, params.id) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: administrationAccessRequestSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await previewAdministrationAccess(session, params.id, body, requestId) }),
})
