import { z } from "zod"
import { placeActionRequestSchema } from "@/lib/contracts/place-action-review"
import { placeActionWorkflowsQuerySchema } from "@/lib/contracts/place-action-workflows"
import { previewPlaceAction } from "@/lib/server/place-action-reviews"
import { listPlaceActionWorkflows } from "@/lib/server/place-action-workflows"
import { route } from "@/lib/server/route"
export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params, handler: async ({ session, params, request }) => ({
  ...await listPlaceActionWorkflows(session, params.id, placeActionWorkflowsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))),
}) })
export const POST = route({ roles: ["owner", "admin"], params, body: placeActionRequestSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await previewPlaceAction(session, params.id, body, requestId) }),
})
