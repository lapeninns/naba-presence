import {
  mediaListResponseSchema,
  mediaMutationOutcomeSchema,
  type MediaCreateInput,
  type MediaDeleteRequest,
  type MediaItem,
  type MediaMutationOutcome,
  type MediaOwnership,
  type MediaState,
  type MediaUpdateRequest,
} from "@/lib/contracts/location-media"
import { GOOGLE_MEDIA_CATEGORIES, type GoogleMediaCategory } from "@/lib/domain/google-contract"

import { ApiClientError, apiFetch, type RequestOptions } from "./client"

export type { MediaItem, MediaOwnership, MediaState }

export const MEDIA_CATEGORIES = GOOGLE_MEDIA_CATEGORIES
export type MediaCategory = GoogleMediaCategory

export type MediaMutationResult = MediaMutationOutcome

export function fetchMedia(
  id: string,
  params: {
    page?: number
    pageSize?: number
    refresh?: boolean
    category?: MediaCategory
    ownership?: MediaOwnership
  } = {},
  options?: RequestOptions
): Promise<MediaState> {
  const query = new URLSearchParams()
  if (params.page) query.set("page", String(params.page))
  if (params.pageSize) query.set("pageSize", String(params.pageSize))
  if (params.refresh) query.set("refresh", "1")
  if (params.category) query.set("category", params.category)
  if (params.ownership) query.set("ownership", params.ownership)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/locations/${id}/media${suffix}`, {
    schema: mediaListResponseSchema,
    ...options,
  }).then((r) => r.media)
}

export function createMediaFromUrl(id: string, input: MediaCreateInput) {
  return apiFetch(`/api/locations/${id}/media`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_media" },
    schema: mediaMutationOutcomeSchema,
  })
}

// Multipart upload via XMLHttpRequest so we can report upload progress (spec §8).
// apiFetch cannot serialise FormData or surface progress. Errors are re-shaped as
// ApiClientError to match the rest of the client. Do NOT set a content-type header —
// the browser adds the multipart boundary.
export function uploadMediaFile(
  id: string,
  form: FormData,
  onProgress?: (fraction: number) => void
): Promise<MediaMutationResult> {
  form.set("confirmation", "create_google_media")
  return new Promise<MediaMutationResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/locations/${id}/media`)
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      let raw: unknown
      try {
        raw = JSON.parse(xhr.responseText)
      } catch {
        raw = xhr.responseText
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = mediaMutationOutcomeSchema.safeParse(raw)
        if (parsed.success) resolve(parsed.data)
        else reject(new ApiClientError(500, "malformed_response", "The server response did not match the expected shape.", parsed.error.issues))
        return
      }
      const record = (raw ?? {}) as Record<string, unknown>
      const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : null
      const code = typeof record.error === "string" ? record.error : nested && typeof nested.code === "string" ? nested.code : "http_error"
      const message = typeof record.message === "string" ? record.message : nested && typeof nested.message === "string" ? nested.message : `Request failed (${xhr.status}).`
      reject(new ApiClientError(xhr.status, code, message, record.details))
    }
    xhr.onerror = () => reject(new ApiClientError(0, "network_error", "The upload could not be completed. Check your connection and try again."))
    xhr.send(form)
  })
}

export function updateMediaCategory(id: string, mediaId: string, input: Omit<MediaUpdateRequest, "confirmation">) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_media" },
    schema: mediaMutationOutcomeSchema,
  })
}

export function deleteMediaItem(id: string, mediaId: string, input: Omit<MediaDeleteRequest, "confirmation">) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_media" },
    schema: mediaMutationOutcomeSchema,
  })
}
