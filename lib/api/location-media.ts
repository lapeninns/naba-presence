import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES, type GoogleMediaCategory } from "@/lib/domain/google-contract"

import { ApiClientError, apiFetch, type RequestOptions } from "./client"

const mediaItemSchema = z.object({
  id: z.string(),
  googleMediaName: z.string(),
  ownership: z.enum(["merchant", "customer"]),
  mediaFormat: z.string(),
  category: z.string().nullable().transform((category) => category ?? "ADDITIONAL"),
  sourceUrl: z.string().nullable(),
  googleUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  description: z.string().nullable(),
  attribution: z.unknown(),
  dimensions: z.unknown(),
  insights: z.unknown(),
  googleHash: z.string(),
  createTime: z.string().nullable(),
})
export type MediaItem = z.infer<typeof mediaItemSchema>

const mediaStateSchema = z.object({
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  categories: z.array(z.string()),
  items: z.array(mediaItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  category: z.string().nullable().optional(),
  ownership: z.enum(["merchant", "customer"]).nullable().optional(),
})
export type MediaState = z.infer<typeof mediaStateSchema>

export const MEDIA_CATEGORIES = GOOGLE_MEDIA_CATEGORIES
export type MediaCategory = GoogleMediaCategory
export type MediaOwnership = "merchant" | "customer"

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })
export type MediaMutationResult = z.infer<typeof mutationResultSchema>

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
    schema: z.object({ media: mediaStateSchema }),
    ...options,
  }).then((r) => r.media)
}

export function createMediaFromUrl(
  id: string,
  input: { mediaFormat: "PHOTO" | "VIDEO"; category: MediaCategory; sourceUrl: string; description?: string }
) {
  return apiFetch(`/api/locations/${id}/media`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_media" },
    schema: mutationResultSchema,
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
        const parsed = mutationResultSchema.safeParse(raw)
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

export function updateMediaCategory(id: string, mediaId: string, input: { category: MediaCategory; expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_media" },
    schema: mutationResultSchema,
  })
}

export function deleteMediaItem(id: string, mediaId: string, input: { expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_media" },
    schema: mutationResultSchema,
  })
}
