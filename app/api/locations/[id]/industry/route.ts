import { z } from "zod"

import {
  industryMutationSchema,
  type IndustryMutationResult,
  type IndustryResponse,
} from "@/lib/contracts/location-industry"
import {
  loadIndustryManagement,
  mutateIndustryManagement,
} from "@/lib/server/industry-management"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
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
    })
  },
})
