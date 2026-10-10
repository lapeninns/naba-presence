import {
  businessInformationMetadataResponseSchema,
  businessInformationMutationResultSchema,
  businessInformationResponseSchema,
  serviceMetadataResponseSchema,
  type BusinessInformationAttributeUpdate,
  type BusinessInformationLocationUpdate,
  type BusinessInformationMetadataQuery,
  type BusinessInformationMetadataResponse,
  type BusinessInformationState,
} from "@/lib/contracts/location-business-information"

import { apiFetch, type RequestOptions } from "./client"
import { gbpChangeSetResponseSchema, gbpChangeSetsResponseSchema } from "@/lib/contracts/gbp-change-set"
import { serviceAttemptResponseSchema } from "@/lib/contracts/service-attempt"
import { serviceWorkflowsResponseSchema } from "@/lib/contracts/service-workflows"

export function fetchServiceWorkflows(id: string, cursor?: string, options?: RequestOptions) {
  const query = new URLSearchParams({ type: "service_workflows" })
  if (cursor) query.set("cursor", cursor)
  return apiFetch(`/api/locations/${id}/business-information?${query}`, { schema: serviceWorkflowsResponseSchema, ...options })
}

export function fetchServiceAttempt(id: string, reviewId: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/business-information?type=service_attempt&changeSetId=${encodeURIComponent(reviewId)}`, {
    schema: serviceAttemptResponseSchema, ...options,
  }).then((result) => result.attempt)
}

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

export function confirmBusinessInformation(id: string, mutationId: string) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "POST", body: { mutationId }, schema: businessInformationMutationResultSchema,
  })
}

export function fetchServiceMetadata(id: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/business-information?type=services`, {
    schema: serviceMetadataResponseSchema, ...options,
  }).then((result) => result.serviceMetadata)
}

export function fetchBusinessInformationReviews(id: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/business-information?type=reviews`, {
    schema: gbpChangeSetsResponseSchema, ...options,
  }).then((result) => result.changeSets)
}

export function publishBusinessInformation(
  id: string,
  input: Pick<BusinessInformationLocationUpdate, "updateMask" | "payload" | "expectedGoogleHash" | "changeSetId">
) {
  const body: BusinessInformationLocationUpdate = {
    operation: "update_location",
    confirmation: "publish_business_information_to_google",
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.updateMask,
    payload: input.payload,
    changeSetId: input.changeSetId,
  }
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body,
    schema: businessInformationMutationResultSchema,
  })
}

export function previewBusinessInformation(id: string, input: Pick<BusinessInformationLocationUpdate, "updateMask" | "payload" | "expectedGoogleHash">) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PUT", body: input, schema: gbpChangeSetResponseSchema,
  }).then((result) => result.changeSet)
}

export function approveBusinessInformation(id: string, changeSetId: string, expectedPayloadHash: string) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "POST", body: { changeSetId, expectedPayloadHash }, schema: gbpChangeSetResponseSchema,
  }).then((result) => result.changeSet)
}

export function publishBusinessAttributes(
  id: string,
  input: Pick<BusinessInformationAttributeUpdate, "attributeMask" | "attributes" | "expectedGoogleHash" | "changeSetId">
) {
  const body: BusinessInformationAttributeUpdate = {
    operation: "update_attributes",
    confirmation: "publish_business_attributes_to_google",
    expectedGoogleHash: input.expectedGoogleHash,
    attributeMask: input.attributeMask,
    attributes: input.attributes,
    changeSetId: input.changeSetId,
  }
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body,
    schema: businessInformationMutationResultSchema,
  })
}

export function previewBusinessAttributes(id: string, input: Pick<BusinessInformationAttributeUpdate, "attributeMask" | "attributes" | "expectedGoogleHash">) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PUT", body: { ...input, operation: "update_attributes" }, schema: gbpChangeSetResponseSchema,
  }).then((result) => result.changeSet)
}

export function approveBusinessAttributes(id: string, changeSetId: string, expectedPayloadHash: string) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "POST", body: { changeSetId, expectedPayloadHash, resourceType: "attributes" }, schema: gbpChangeSetResponseSchema,
  }).then((result) => result.changeSet)
}

export function fetchBusinessAttributeReviews(id: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${id}/business-information?type=attribute_reviews`, {
    schema: gbpChangeSetsResponseSchema, ...options,
  }).then((result) => result.changeSets)
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
