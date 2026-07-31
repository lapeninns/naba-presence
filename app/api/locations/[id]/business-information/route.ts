import { NextResponse } from "next/server"
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
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const search = new URL(request.url).searchParams
    const type = search.get("type")
    if (type === "categories" || type === "chains") {
      const query = search.get("query")?.trim() ?? ""
      if (!query) throw new ApiError(400, "search_query_required", "Enter a search term.")
      return NextResponse.json({
        result: await searchBusinessInformationMetadata({
          session,
          locationId,
          type,
          query,
          regionCode: search.get("regionCode") ?? "GB",
          languageCode: search.get("languageCode") ?? "en",
        }),
      })
    }
    return NextResponse.json({
      businessInformation: await loadBusinessInformation(session, locationId),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const input = z
      .discriminatedUnion("operation", [
        locationUpdateSchema,
        attributeUpdateSchema,
      ])
      .parse(await request.json())
    const result =
      input.operation === "update_location"
        ? await updateBusinessInformation({
            session,
            locationId,
            payload: input.payload,
            updateMask: input.updateMask,
            expectedGoogleHash: input.expectedGoogleHash,
            requestId: rid.id,
          })
        : await updateBusinessAttributes({
            session,
            locationId,
            attributes: input.attributes,
            attributeMask: input.attributeMask,
            expectedGoogleHash: input.expectedGoogleHash,
            requestId: rid.id,
          })
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
