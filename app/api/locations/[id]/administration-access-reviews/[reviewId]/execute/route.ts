import { z } from "zod"
import { administrationAccessApprovalSchema } from "@/lib/contracts/google-administration-review"
import { readAdministrationAccessAttempt } from "@/lib/server/google-administration-attempts"
import { executeAdministrationAccess, refreshAdministrationAccessAttempt } from "@/lib/server/google-administration-execution"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ attempt: await readAdministrationAccessAttempt(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: administrationAccessApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ attempt: await executeAdministrationAccess(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
export const PATCH = route({ roles: ["owner", "admin"], params, body: z.strictObject({}),
  handler: async ({ session, params, requestId }) => ({ attempt: await refreshAdministrationAccessAttempt(session, params.id, params.reviewId, requestId) }),
})
