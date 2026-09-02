import {
  businessInformationMetadataResponseSchema,
  businessInformationMutationResultSchema,
  businessInformationResponseSchema,
  type BusinessInformationAttributeUpdate,
  type BusinessInformationLocationUpdate,
  type BusinessInformationMetadataQuery,
  type BusinessInformationMetadataResponse,
  type BusinessInformationState,
} from "@/lib/contracts/location-business-information"

import { apiFetch, type RequestOptions } from "./client"

export type {
  AttributeMetadata,
  BusinessInformationState,
  BusinessMask,
  GoogleAttribute,
} from "@/lib/contracts/location-business-information"

export function fetchBusinessInformation(id: string, options?: RequestOptions): Promise<BusinessInformationState> {
  return apiFetch(`/api/locations/${id}/business-information`, {
    schema: businessInformationResponseSchema,
    ...options,
  }).then((r) => r.businessInformation)
}

export function publishBusinessInformation(
  id: string,
  input: Pick<BusinessInformationLocationUpdate, "updateMask" | "payload" | "expectedGoogleHash">
) {
  const body: BusinessInformationLocationUpdate = {
    operation: "update_location",
    confirmation: "publish_business_information_to_google",
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.updateMask,
    payload: input.payload,
  }
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body,
    schema: businessInformationMutationResultSchema,
  })
}

export function publishBusinessAttributes(
  id: string,
  input: Pick<BusinessInformationAttributeUpdate, "attributeMask" | "attributes" | "expectedGoogleHash">
) {
  const body: BusinessInformationAttributeUpdate = {
    operation: "update_attributes",
    confirmation: "publish_business_attributes_to_google",
    expectedGoogleHash: input.expectedGoogleHash,
    attributeMask: input.attributeMask,
    attributes: input.attributes,
  }
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body,
    schema: businessInformationMutationResultSchema,
  })
}

export function fetchBusinessInformationMetadata(
  id: string,
  params: BusinessInformationMetadataQuery,
  options?: RequestOptions
): Promise<BusinessInformationMetadataResponse> {
  const query = new URLSearchParams({ type: params.type, query: params.query, regionCode: params.regionCode ?? "GB", languageCode: params.languageCode ?? "en" })
  return apiFetch(`/api/locations/${id}/business-information?${query}`, {
    schema: businessInformationMetadataResponseSchema,
    ...options,
  })
}
