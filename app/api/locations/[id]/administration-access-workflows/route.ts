import { z } from "zod"
import { administrationWorkflowsQuerySchema } from "@/lib/contracts/google-administration-workflows"
import { listAdministrationWorkflows } from "@/lib/server/google-administration-workflows"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({ maxDuration, roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), query: administrationWorkflowsQuerySchema,
  handler: ({ session, params, query }) => listAdministrationWorkflows(session, params.id, query),
})
