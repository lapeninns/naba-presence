import { z } from "zod"
import { googleLifecycleRequestSchema } from "@/lib/contracts/google-lifecycle"
import { lifecycleWorkflowsQuerySchema } from "@/lib/contracts/google-lifecycle-workflows"
import { previewLifecycle } from "@/lib/server/google-lifecycle-reviews"
import { listLifecycleWorkflows } from "@/lib/server/google-lifecycle-workflows"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({ roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), query: lifecycleWorkflowsQuerySchema,
  handler: async ({ session, params, query }) => listLifecycleWorkflows(session, params.id, query),
})
export const POST = route({ roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), body: googleLifecycleRequestSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await previewLifecycle(session, params.id, body, requestId) }),
})
