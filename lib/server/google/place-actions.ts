import "server-only"

import {
  GOOGLE_PLACE_ACTION_TYPES,
  googlePlaceActionLinkCreateRequest,
  googlePlaceActionLinkDeleteRequest,
  googlePlaceActionLinkGetRequest,
  googlePlaceActionLinkPatchRequest,
  googlePlaceActionLinksListRequest,
  type GooglePlaceActionType,
} from "@/lib/domain/google-contract"
import { ApiError } from "@/lib/server/http"

import { googleRequest } from "./transport"

export type GooglePlaceActionLink = {
  name: string
  providerType: string
  isEditable: boolean
  uri: string
  placeActionType: GooglePlaceActionType
  isPreferred: boolean
  createTime: string | null
  updateTime: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isGooglePlaceActionType(
  value: string
): value is GooglePlaceActionType {
  const knownTypes: readonly string[] = GOOGLE_PLACE_ACTION_TYPES
  return knownTypes.includes(value)
}

export function normalizeGooglePlaceActionLink(
  value: unknown
): GooglePlaceActionLink | null {
  if (!isRecord(value)) return null
  const name = value["name"]
  const uri = value["uri"]
  const placeActionType = value["placeActionType"]
  if (
    typeof name !== "string" ||
    typeof uri !== "string" ||
    !uri ||
    typeof placeActionType !== "string" ||
    !isGooglePlaceActionType(placeActionType)
  ) {
    return null
  }
  const providerType = value["providerType"]
  const createTime = value["createTime"]
  const updateTime = value["updateTime"]
  return {
    name,
    providerType:
      typeof providerType === "string"
        ? providerType
        : "PROVIDER_TYPE_UNSPECIFIED",
    isEditable: value["isEditable"] === true,
    uri,
    placeActionType,
    isPreferred: value["isPreferred"] === true,
    createTime: typeof createTime === "string" ? createTime : null,
    updateTime: typeof updateTime === "string" ? updateTime : null,
  }
}

export async function listGooglePlaceActionLinks(
  accessToken: string,
  locationName: string,
  options: { readonly connectionKey?: string } = {}
): Promise<GooglePlaceActionLink[]> {
  const links: GooglePlaceActionLink[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const request = googlePlaceActionLinksListRequest({
      locationName,
      pageToken,
    })
    const response = await googleRequest<Record<string, unknown>>(
      request.url,
      accessToken,
      request.init,
      options
    )
    const rawLinks = Array.isArray(response["placeActionLinks"])
      ? response["placeActionLinks"]
      : []
    for (const rawLink of rawLinks) {
      const link = normalizeGooglePlaceActionLink(rawLink)
      if (link) links.push(link)
    }
    const nextPageToken = response["nextPageToken"]
    pageToken =
      typeof nextPageToken === "string" && nextPageToken
        ? nextPageToken
        : undefined
    if (!pageToken) return links
  }
  throw new ApiError(
    502,
    "google_place_action_page_limit",
    "Google Place Action pagination exceeded the safety limit."
  )
}

export async function createGooglePlaceActionLink(
  accessToken: string,
  input: {
    readonly locationName: string
    readonly payload: {
      readonly uri: string
      readonly placeActionType: GooglePlaceActionType
      readonly isPreferred: boolean
    }
  },
  options: { readonly connectionKey?: string } = {}
): Promise<Record<string, unknown>> {
  const request = googlePlaceActionLinkCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function getGooglePlaceActionLink(
  accessToken: string,
  name: string,
  options: { readonly connectionKey?: string } = {}
): Promise<Record<string, unknown>> {
  const request = googlePlaceActionLinkGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export async function patchGooglePlaceActionLink(
  accessToken: string,
  input: {
    readonly name: string
    readonly payload: {
      readonly uri: string
      readonly placeActionType: GooglePlaceActionType
      readonly isPreferred: boolean
    }
  },
  options: { readonly connectionKey?: string } = {}
): Promise<Record<string, unknown>> {
  const request = googlePlaceActionLinkPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function deleteGooglePlaceActionLink(
  accessToken: string,
  name: string,
  options: { readonly connectionKey?: string } = {}
): Promise<null> {
  const request = googlePlaceActionLinkDeleteRequest(name)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}
