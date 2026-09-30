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

/** A well-formed provider link whose action type this release does not model. Read-only; managed in Google. */
export type GoogleUnsupportedPlaceActionLink = {
  name: string
  providerType: string
  uri: string
  placeActionType: string
}

export type GooglePlaceActionCollection = {
  links: GooglePlaceActionLink[]
  unsupportedLinks: GoogleUnsupportedPlaceActionLink[]
}

function unsupportedGooglePlaceActionLink(value: unknown): GoogleUnsupportedPlaceActionLink | null {
  if (!isRecord(value)) return null
  const { name, uri, placeActionType, providerType } = value
  if (typeof name !== "string" || typeof uri !== "string" || !uri || typeof placeActionType !== "string" || !placeActionType || isGooglePlaceActionType(placeActionType)) return null
  return { name, uri, placeActionType, providerType: typeof providerType === "string" ? providerType : "PROVIDER_TYPE_UNSPECIFIED" }
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
): Promise<GooglePlaceActionCollection> {
  const links: GooglePlaceActionLink[] = []
  const unsupportedLinks: GoogleUnsupportedPlaceActionLink[] = []
  const seenTokens = new Set<string>(), seenNames = new Set<string>()
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
    if (!isRecord(response) || Object.hasOwn(response, "placeActionLinks") && !Array.isArray(response["placeActionLinks"])) throw new ApiError(502, "place_action_observation_unreadable", "Google returned an unreadable action link collection.")
    const rawLinks = Array.isArray(response["placeActionLinks"])
      ? response["placeActionLinks"]
      : []
    for (const rawLink of rawLinks) {
      // A well-formed link of a future action type is kept as a read-only row;
      // malformed, duplicate or unrelated rows still reject the whole collection.
      const link = normalizeGooglePlaceActionLink(rawLink)
      const unsupported = link ? null : unsupportedGooglePlaceActionLink(rawLink)
      const name = link?.name ?? unsupported?.name
      if (!name || !name.startsWith(`${locationName}/placeActionLinks/`) || seenNames.has(name)) throw new ApiError(502, "place_action_observation_unreadable", "Google returned an unreadable, duplicate or unrelated action link. Continue in Google or refresh before reviewing a change.")
      seenNames.add(name)
      if (link) links.push(link)
      else if (unsupported) unsupportedLinks.push(unsupported)
    }
    const nextPageToken = response["nextPageToken"]
    if (nextPageToken !== undefined && typeof nextPageToken !== "string") throw new ApiError(502, "place_action_observation_unreadable", "Google returned an unreadable action link page token.")
    pageToken =
      typeof nextPageToken === "string" && nextPageToken
        ? nextPageToken
        : undefined
    if (!pageToken) return { links, unsupportedLinks }
    if (seenTokens.has(pageToken)) throw new ApiError(502, "google_place_action_page_limit", "Google repeated an action link page token. No partial collection was accepted.")
    seenTokens.add(pageToken)
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
