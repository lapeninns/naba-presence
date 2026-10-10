import "server-only"

import {
  googleMediaBinaryUploadRequest,
  googleMediaCreateRequest,
  googleMediaDeleteRequest,
  googleMediaGetRequest,
  googleMediaListRequest,
  googleMediaPatchRequest,
  googleMediaStartUploadRequest,
  type GoogleMediaCategory,
} from "@/lib/domain/google-contract"
import { ApiError } from "@/lib/server/http"
import { googleRequest } from "./transport"

export async function googleMediaItems(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    customer: boolean
  },
  options: { connectionKey?: string } = {}
) {
  const items: Array<Record<string, unknown>> = []
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const request = googleMediaListRequest({ ...input, pageToken })
    const response = await googleRequest<{
      mediaItems?: Array<Record<string, unknown>>
      nextPageToken?: string
    }>(request.url, accessToken, request.init, options)
    items.push(...(response.mediaItems ?? []))
    pageToken = response.nextPageToken || undefined
    if (!pageToken) return items
  }
  throw new ApiError(
    502,
    "google_media_page_limit",
    "Google media pagination exceeded the safety limit."
  )
}

export function createGoogleMediaItem(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    payload: {
      mediaFormat: "PHOTO" | "VIDEO"
      locationAssociation: { category: GoogleMediaCategory }
      sourceUrl?: string
      dataRef?: { resourceName: string }
      description?: string
    }
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

/**
 * Reserves an upload reference for the bytes (`media:startUpload`). The two
 * upload steps are separate calls so lib/server/media.ts can record each
 * checkpoint on the attempt before the next one goes out.
 */
export async function startGoogleMediaUpload(
  accessToken: string,
  input: { accountName: string; locationName: string },
  options: { connectionKey?: string } = {}
): Promise<{ resourceName: string }> {
  const start = googleMediaStartUploadRequest(input)
  const dataRef = await googleRequest<{ resourceName?: string }>(
    start.url,
    accessToken,
    start.init,
    { ...options, mode: "mutation" }
  )
  // Stays a plain failure, unlike the other malformed answers: starting an
  // upload only reserves a reference, so with none returned no bytes were
  // sent and no media item can exist.
  if (!dataRef.resourceName) {
    throw new ApiError(
      502,
      "media_data_ref_missing",
      "Google did not return a media upload reference."
    )
  }
  return { resourceName: dataRef.resourceName }
}

/**
 * Sends the bytes to a reserved reference. Uploading alone puts nothing on
 * the listing: only a create that names the reference does.
 */
export async function sendGoogleMediaBytes(
  accessToken: string,
  input: { resourceName: string; bytes: ArrayBuffer; contentType: string },
  options: { connectionKey?: string } = {}
): Promise<void> {
  const upload = googleMediaBinaryUploadRequest(input)
  // The upload answer is never read: its 2xx status alone confirms the bytes.
  await googleRequest<unknown>(upload.url, accessToken, upload.init, {
    ...options,
    mode: "mutation",
    successBody: "ignored",
  })
}

export function getGoogleMediaItem(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleMediaItem(
  accessToken: string,
  input: { name: string; category: GoogleMediaCategory },
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleMediaItem(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaDeleteRequest(name)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}
