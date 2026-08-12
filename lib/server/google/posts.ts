import "server-only"

import {
  googleLocalPostCreateRequest,
  googleLocalPostDeleteRequest,
  googleLocalPostGetRequest,
  googleLocalPostPatchRequest,
  googleLocalPostsListRequest,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function googleLocalPosts(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostsListRequest(input)
  return googleRequest<{
    localPosts?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function createGoogleLocalPost(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function getGoogleLocalPost(
  accessToken: string,
  postName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostGetRequest(postName)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocalPost(
  accessToken: string,
  input: {
    postName: string
    updateMask: string[]
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleLocalPost(
  accessToken: string,
  postName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostDeleteRequest(postName)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}
