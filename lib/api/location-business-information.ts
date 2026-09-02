import { z } from "zod"

import { BUSINESS_INFORMATION_UPDATE_MASKS, businessInformationPayloadSchema, googleAttributeSchema } from "@/lib/domain/business-information"
import { apiFetch, type RequestOptions } from "./client"

// The Google location + attributes are freeform (they vary by category and by
// what the merchant has set), so keep them as passthrough records — the editor
// reads known leaves and preserves the rest. Only the envelope is pinned.
const attributeMetadataSchema = z.looseObject({
  parent: z.string(),
  displayName: z.string().optional(),
  groupDisplayName: z.string().optional(),
  valueType: z.string().optional(),
})

const businessInformationStateSchema = z.object({
  location: z.record(z.string(), z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  attributeMetadata: z.array(attributeMetadataSchema),
  locationHash: z.string().length(64),
  attributesHash: z.string().length(64),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
})

export type AttributeMetadata = z.infer<typeof attributeMetadataSchema>
export type GoogleAttribute = z.infer<typeof googleAttributeSchema>
export type BusinessInformationState = z.infer<typeof businessInformationStateSchema>
export type BusinessMask = (typeof BUSINESS_INFORMATION_UPDATE_MASKS)[number]

export function fetchBusinessInformation(id: string, options?: RequestOptions): Promise<BusinessInformationState> {
  return apiFetch(`/api/locations/${id}/business-information`, {
    schema: z.object({ businessInformation: businessInformationStateSchema }),
    ...options,
  }).then((r) => r.businessInformation)
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function publishBusinessInformation(
  id: string,
  input: { updateMask: BusinessMask[]; payload: z.infer<typeof businessInformationPayloadSchema>; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body: {
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      expectedGoogleHash: input.expectedGoogleHash,
      updateMask: input.updateMask,
      payload: input.payload,
    },
    schema: mutationResultSchema,
  })
}

export function publishBusinessAttributes(
  id: string,
  input: { attributeMask: string[]; attributes: GoogleAttribute[]; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body: {
      operation: "update_attributes",
      confirmation: "publish_business_attributes_to_google",
      expectedGoogleHash: input.expectedGoogleHash,
      attributeMask: input.attributeMask,
      attributes: input.attributes,
    },
    schema: mutationResultSchema,
  })
}

export function fetchBusinessInformationMetadata(
  id: string,
  params: { type: "categories" | "chains"; query: string; regionCode?: string; languageCode?: string },
  options?: RequestOptions
): Promise<{ result: unknown }> {
  const query = new URLSearchParams({ type: params.type, query: params.query, regionCode: params.regionCode ?? "GB", languageCode: params.languageCode ?? "en" })
  return apiFetch(`/api/locations/${id}/business-information?${query}`, {
    schema: z.object({ result: z.unknown() }),
    ...options,
  })
}
