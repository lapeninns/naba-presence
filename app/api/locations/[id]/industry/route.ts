import { z } from "zod"

import {
  industryMutationSchema,
  type IndustryMutationResult,
  type IndustryResponse,
} from "@/lib/contracts/location-industry"
import { googleApiRetiredError } from "@/lib/server/google"
import {
  loadIndustryManagement,
  mutateIndustryManagement,
} from "@/lib/server/industry-management"
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
      expectedGoogleHash:
        body.operation === "update_lodging"
          ? body.expectedGoogleHash
          : undefined,
      requestId,
    })
  },
})
