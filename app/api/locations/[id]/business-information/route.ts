import { z } from "zod"

import {
  BUSINESS_INFORMATION_UPDATE_MASKS,
  businessInformationPayloadSchema,
  googleAttributeSchema,
} from "@/lib/domain/business-information"
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

const locationUpdateSchema = z.object({
  operation: z.literal("update_location"),
  confirmation: z.literal("publish_business_information_to_google"),
  expectedGoogleHash: z.string().length(64),
  updateMask: z.array(z.enum(BUSINESS_INFORMATION_UPDATE_MASKS)).min(1),
  payload: businessInformationPayloadSchema,
})

const attributeUpdateSchema = z.object({
  operation: z.literal("update_attributes"),
  confirmation: z.literal("publish_business_attributes_to_google"),
  expectedGoogleHash: z.string().length(64),
  attributeMask: z.array(z.string().trim().min(1)).min(1),
  attributes: z.array(googleAttributeSchema),
})

const patchSchema = z.discriminatedUnion("operation", [
  locationUpdateSchema,
  attributeUpdateSchema,
])

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params, query: search }) => {
    const type = search.get("type")
    if (type === "categories" || type === "chains") {
      const query = search.get("query")?.trim() ?? ""
      if (!query) throw new ApiError(400, "search_query_required", "Enter a search term.")
      return {
        result: await searchBusinessInformationMetadata({
          session,
          locationId: params.id,
          type,
          query,
          regionCode: search.get("regionCode") ?? "GB",
          languageCode: search.get("languageCode") ?? "en",
        }),
      }
    }
    return {
      businessInformation: await loadBusinessInformation(session, params.id),
    }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: patchSchema,
  handler: ({ session, params, body, requestId }) =>
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
