import { z } from "zod"

import {
  industryMutationSchema,
  industryConfirmationRequestSchema,
  type IndustryMutationResult,
  type IndustryResponse,
} from "@/lib/contracts/location-industry"
import {
  loadIndustryManagement,
  mutateIndustryManagement,
  confirmIndustryManagement,
} from "@/lib/server/industry-management"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import { lodgingPreviewRequestSchema, approveGbpChangeSetRequestSchema } from "@/lib/contracts/gbp-change-set"
import { previewLodgingChange, approveLodgingChange } from "@/lib/server/gbp-change-sets"
import { readLodgingAttempt } from "@/lib/server/lodging-attempt"
import { lodgingWorkflowsQuerySchema } from "@/lib/contracts/lodging-workflows"
import { listLodgingWorkflows } from "@/lib/server/lodging-workflows"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: z.union([approveGbpChangeSetRequestSchema, industryConfirmationRequestSchema]),
  handler: async ({ session, params, body, requestId }) => "action" in body
    ? { changeSet: await approveLodgingChange(session, params.id, body.changeSetId, body.expectedPayloadHash, requestId) }
    : confirmIndustryManagement(session, params.id, body.mutationId, requestId),
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: lodgingPreviewRequestSchema,
  handler: async ({ session, params, body, requestId }) => ({ changeSet: await previewLodgingChange(session, params.id, body, requestId) }),
})

export const GET = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  query: z.union([z.object({ type: z.literal("attempt").default("attempt"), reviewId: z.uuid() }).strict(), lodgingWorkflowsQuerySchema, z.object({ type: z.literal("resource").default("resource") }).strict()]),
  handler: async ({ session, params, query }) => query.type === "attempt"
    ? { attempt: await readLodgingAttempt(session, params.id, query.reviewId) }
    : query.type === "workflows" ? listLodgingWorkflows(session, params.id, query) : ({
      industry: await loadIndustryManagement(session, params.id),
    }) satisfies IndustryResponse,
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: industryMutationSchema,
  handler: ({ session, params, body, requestId }): Promise<IndustryMutationResult> => {
    if (
      body.operation === "update_business_calls" &&
      body.updateMask.some((field) => field !== "callsState")
    ) {
      throw new ApiError(
        422,
        "business_calls_mask_invalid",
        "Only callsState can be updated for Business Calls."
      )
    }
    return mutateIndustryManagement({
      session,
      locationId: params.id,
      operation: body.operation,
      payload: body.payload as Record<string, unknown>,
      updateMask: [...body.updateMask],
      requestId,
      changeSetId: body.operation === "update_lodging" ? body.changeSetId : undefined,
    })
  },
})
