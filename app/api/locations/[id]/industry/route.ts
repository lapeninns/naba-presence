import { z } from "zod"

import {
  industryMutationSchema,
  type IndustryMutationResult,
  type IndustryResponse,
} from "@/lib/contracts/location-industry"
import { googleApiRetiredError } from "@/lib/server/google"
import { loadIndustryManagement } from "@/lib/server/industry-management"
import { submitListingChange } from "@/lib/server/listing-change-registry"
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
  }): Promise<IndustryMutationResult | Response> => {
    // Google switched these APIs off (Business Calls 2023-05-30, provider
    // attributes 2024-07-01). Answer the same stable 410 the transport would,
    // before resolving the location or recording a mutation attempt.
    if (body.operation === "update_business_calls") {
      throw googleApiRetiredError("business_calls")
    }
    if (body.operation === "update_healthcare_provider_attributes") {
      throw googleApiRetiredError("health_provider_attributes")
    }
    // Parks for a second publisher in two-person mode
    // (lib/server/listing-change-registry.ts); sent as before otherwise.
    return submitListingChange("industry_update", {
      session,
      locationId: params.id,
      body,
      requestId,
    })
  },
})
