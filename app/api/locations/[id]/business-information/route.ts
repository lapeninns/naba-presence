import { z } from "zod"

import {
  businessInformationMetadataTypeSchema,
  businessInformationPatchSchema,
  businessInformationPreviewSchema,
  businessAttributesPreviewSchema,
  businessInformationApprovalSchema,
  businessInformationConfirmationSchema,
  type BusinessInformationMetadataResponse,
  type BusinessInformationMutationResult,
  type BusinessInformationResponse,
} from "@/lib/contracts/location-business-information"
import {
  loadBusinessInformation,
  confirmBusinessInformation,
  loadBusinessInformationReviews,
  loadLocationServiceMetadata,
  previewBusinessInformation,
  previewBusinessAttributes,
  loadBusinessAttributeReviews,
  searchBusinessInformationMetadata,
  updateBusinessAttributes,
  updateBusinessInformation,
} from "@/lib/server/business-information"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import { approveGbpChange } from "@/lib/server/gbp-change-sets"
import { readServiceAttempt } from "@/lib/server/service-attempt"
import { listServiceWorkflows } from "@/lib/server/service-workflows"
import { serviceWorkflowsQuerySchema } from "@/lib/contracts/service-workflows"

export const runtime = "nodejs"
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params, query: search }) => {
    if (search.get("type") === "service_workflows") return listServiceWorkflows(session, params.id, serviceWorkflowsQuerySchema.parse(Object.fromEntries(search)))
    if (search.get("type") === "service_attempt") {
      const query = z.strictObject({ type: z.literal("service_attempt"), changeSetId: z.uuid() }).parse(Object.fromEntries(search))
      return { attempt: await readServiceAttempt(session, params.id, query.changeSetId) }
    }
    if (search.get("type") === "attribute_reviews") return { changeSets: await loadBusinessAttributeReviews(session, params.id) }
    if (search.get("type") === "reviews") {
      return { changeSets: await loadBusinessInformationReviews(session, params.id) }
    }
    if (search.get("type") === "services") {
      return { serviceMetadata: await loadLocationServiceMetadata(session, params.id) }
    }
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
          changeSetId: body.changeSetId,
        })
      : updateBusinessAttributes({
          session,
          locationId: params.id,
          attributes: body.attributes,
          attributeMask: body.attributeMask,
          changeSetId: body.changeSetId,
          expectedGoogleHash: body.expectedGoogleHash,
          requestId,
        }),
})

export const PUT = route({
  roles: ["owner", "admin"], params: paramsSchema, body: z.union([businessInformationPreviewSchema, businessAttributesPreviewSchema]),
  handler: async ({ session, params, body, requestId }) => ({
    changeSet: "attributeMask" in body
      ? await previewBusinessAttributes({ session, locationId: params.id, ...body, requestId })
      : await previewBusinessInformation({ session, locationId: params.id, ...body, requestId }),
  }),
})

export const POST = route({
  roles: ["owner", "admin"], params: paramsSchema, body: z.union([businessInformationConfirmationSchema, businessInformationApprovalSchema]),
  handler: async ({ session, params, body, requestId }) => "mutationId" in body
    ? confirmBusinessInformation(session, params.id, body.mutationId, requestId)
    : { changeSet: await approveGbpChange({ session, locationId: params.id, ...body, requestId }) },
})
