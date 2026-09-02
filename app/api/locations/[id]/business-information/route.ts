import { z } from "zod"

import {
  businessInformationMetadataTypeSchema,
  businessInformationPatchSchema,
  type BusinessInformationMetadataResponse,
  type BusinessInformationMutationResult,
  type BusinessInformationResponse,
} from "@/lib/contracts/location-business-information"
import {
  loadBusinessInformation,
  searchBusinessInformationMetadata,
  updateBusinessAttributes,
  updateBusinessInformation,
} from "@/lib/server/business-information"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params, query: search }) => {
    const type = businessInformationMetadataTypeSchema.safeParse(search.get("type"))
    if (type.success) {
      const query = search.get("query")?.trim() ?? ""
      if (!query) throw new ApiError(400, "search_query_required", "Enter a search term.")
      return {
        result: await searchBusinessInformationMetadata({
          session,
          locationId: params.id,
          type: type.data,
          query,
          regionCode: search.get("regionCode") ?? "GB",
          languageCode: search.get("languageCode") ?? "en",
        }),
      } satisfies BusinessInformationMetadataResponse
    }
    return {
      businessInformation: await loadBusinessInformation(session, params.id),
    } satisfies BusinessInformationResponse
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: businessInformationPatchSchema,
  handler: ({ session, params, body, requestId }): Promise<BusinessInformationMutationResult> =>
    body.operation === "update_location"
      ? updateBusinessInformation({
          session,
          locationId: params.id,
          payload: body.payload,
          updateMask: body.updateMask,
          expectedGoogleHash: body.expectedGoogleHash,
          requestId,
        })
      : updateBusinessAttributes({
          session,
          locationId: params.id,
          attributes: body.attributes,
          attributeMask: body.attributeMask,
          expectedGoogleHash: body.expectedGoogleHash,
          requestId,
        }),
})
