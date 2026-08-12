import "server-only"

import {
  googleAttributeMetadataRequest,
  googleAccountsRequest,
  googleCategoriesRequest,
  googleChainsSearchRequest,
  googleLocationAttributesPatchRequest,
  googleLocationAttributesRequest,
  googleLocationCreateRequest,
  googleLocationDeleteRequest,
  googleLocationHoursPatchRequest,
  googleLocationPatchRequest,
  googleLocationRequest,
  googleLocationsSearchRequest,
  googleLocationUpdatedRequest,
  type GoogleHoursUpdateMask,
  type GoogleLocationReadField,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function googleAccounts(
  accessToken: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleAccountsRequest(pageToken)
  return googleRequest<{
    accounts?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function googleLocations(
  accessToken: string,
  accountName: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
) {
  const params = new URLSearchParams({
    readMask:
      "name,title,storeCode,phoneNumbers,categories,storefrontAddress,metadata",
    pageSize: "100",
  })
  if (pageToken) params.set("pageToken", pageToken)
  return googleRequest<{
    locations?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params}`,
    accessToken,
    {},
    options
  )
}

export function getGoogleLocation(
  accessToken: string,
  locationName: string,
  readMask: GoogleLocationReadField[],
  options: { connectionKey?: string; maxAttempts?: number } = {}
) {
  const request = googleLocationRequest(locationName, readMask)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocationHours(
  accessToken: string,
  input: {
    locationName: string
    updateMask: GoogleHoursUpdateMask[]
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleLocationHoursPatchRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      // Google guarantees validateOnly does not apply the patch, so retries
      // are safe. The real write stays single-attempt and ambiguity-aware.
      mode: input.validateOnly ? "safe" : "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export function patchGoogleLocation(
  accessToken: string,
  input: {
    locationName: string
    updateMask: string[]
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function getGoogleLocationAttributes(
  accessToken: string,
  locationName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationAttributesRequest(locationName)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocationAttributes(
  accessToken: string,
  input: {
    locationName: string
    attributeMask: string[]
    attributes: Array<Record<string, unknown>>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationAttributesPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function listGoogleAttributeMetadata(
  accessToken: string,
  input: { locationName: string; languageCode?: string; pageToken?: string },
  options: { connectionKey?: string } = {}
) {
  const request = googleAttributeMetadataRequest(input)
  return googleRequest<{
    attributeMetadata?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function listGoogleCategories(
  accessToken: string,
  input: {
    regionCode: string
    languageCode: string
    query?: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleCategoriesRequest(input)
  return googleRequest<{
    categories?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function searchGoogleChains(
  accessToken: string,
  query: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleChainsSearchRequest(query)
  return googleRequest<{ chains?: Array<Record<string, unknown>> }>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function createGoogleLocation(
  accessToken: string,
  input: {
    accountName: string
    requestId: string
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleLocation(
  accessToken: string,
  locationName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationDeleteRequest(locationName)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}

export function getGoogleUpdatedLocation(
  accessToken: string,
  locationName: string,
  readMask: string[],
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationUpdatedRequest(locationName, readMask)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function searchGoogleLocations(
  accessToken: string,
  payload: Record<string, unknown>,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationsSearchRequest(payload)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}
