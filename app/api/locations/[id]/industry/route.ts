import { z } from "zod"

import {
  industryMutationSchema,
  industryConfirmationRequestSchema,
  type IndustryMutationResult,
  type IndustryResponse,
} from "@/lib/contracts/location-industry"
import { googleApiRetiredError } from "@/lib/server/google"
import {
  loadIndustryManagement,
  mutateIndustryManagement,
  confirmIndustryManagement,
} from "@/lib/server/industry-management"
import { route } from "@/lib/server/route"
import { approveGbpChangeSetRequestSchema } from "@/lib/contracts/gbp-change-set"
import { lodgingPreviewRequestSchema } from "@/lib/contracts/lodging-preview"
import { previewLodgingChange, approveLodgingChange } from "@/lib/server/gbp-change-sets"
import { readLodgingAttempt } from "@/lib/server/lodging-attempt"
import { lodgingWorkflowsQuerySchema } from "@/lib/contracts/lodging-workflows"
import { listLodgingWorkflows } from "@/lib/server/lodging-workflows"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: z.union([approveGbpChangeSetRequestSchema, industryConfirmationRequestSchema]),
  handler: async ({ session, params, body, requestId }) => "action" in body
    ? { changeSet: await approveLodgingChange(session, params.id, body.changeSetId, body.expectedPayloadHash, requestId) }
    : confirmIndustryManagement(session, params.id, body.mutationId, requestId),
})

export const PUT = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: lodgingPreviewRequestSchema,
  handler: async ({ session, params, body, requestId }) => ({ changeSet: await previewLodgingChange(session, params.id, body, requestId) }),
})

export const GET = route({
  maxDuration,
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
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: industryMutationSchema,
  handler: ({
    session,
    params,
    body,
    requestId,
  }): Promise<IndustryMutationResult> => {
    // Google switched these APIs off (Business Calls 2023-05-30, provider
    // attributes 2024-07-01). Answer the same stable 410 the transport would,
    // before resolving the location or recording a mutation attempt.
    if (body.operation === "update_business_calls") {
      throw googleApiRetiredError("business_calls")
    }
    if (body.operation === "update_healthcare_provider_attributes") {
      throw googleApiRetiredError("health_provider_attributes")
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
