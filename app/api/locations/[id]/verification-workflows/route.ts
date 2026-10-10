import { z } from "zod"
import { verificationWorkflowQuerySchema } from "@/lib/contracts/google-verification-workflows"
import { listVerificationWorkflows } from "@/lib/server/google-verification-workflows"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const GET = route({ roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), query: verificationWorkflowQuerySchema,
  handler: ({ session, params, query }) => listVerificationWorkflows(session, params.id, query),
})
