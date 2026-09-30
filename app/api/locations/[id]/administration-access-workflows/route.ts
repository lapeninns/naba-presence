import { z } from "zod"
import { administrationWorkflowsQuerySchema } from "@/lib/contracts/google-administration-workflows"
import { listAdministrationWorkflows } from "@/lib/server/google-administration-workflows"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const GET = route({ roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), query: administrationWorkflowsQuerySchema,
  handler: ({ session, params, query }) => listAdministrationWorkflows(session, params.id, query),
})
