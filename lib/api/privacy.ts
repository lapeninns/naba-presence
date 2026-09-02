import { z } from "zod"

import { ApiClientError, apiFetch, type RequestOptions } from "./client"
import { PRIVACY_REQUEST_TYPES } from "@/lib/settings/forms/privacy-request"

export const privacyRequestSchema = z.object({
  id: z.string(),
  requestType: z.enum(PRIVACY_REQUEST_TYPES),
  status: z.string(),
  subjectReference: z.string(),
  reason: z.string().nullable(),
  requestedBy: z.string(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const requestsResponseSchema = z.object({ requests: z.array(privacyRequestSchema) })
const createResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: z.enum(PRIVACY_REQUEST_TYPES),
    status: z.string(),
    subjectReference: z.string(),
    createdAt: z.string(),
  }),
})
const resolutionResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: z.enum(PRIVACY_REQUEST_TYPES),
    status: z.string(),
    subjectReference: z.string(),
    resolutionNote: z.string().nullable(),
    resolvedAt: z.string().nullable(),
  }),
})

export type PrivacyRequest = z.infer<typeof privacyRequestSchema>

export function fetchPrivacyRequests(options?: RequestOptions) {
  return apiFetch("/api/privacy/requests", { schema: requestsResponseSchema, ...options })
}

export function createPrivacyRequest(input: {
  requestType: string
  subjectReference: string
  reason?: string
}) {
  return apiFetch("/api/privacy/requests", { method: "POST", body: input, schema: createResponseSchema })
}

export type UpdatePrivacyInput =
  | { id: string; action: "fulfil"; resolutionNote: string }
  | { id: string; status: string; resolutionNote: string }

export function updatePrivacyRequest(input: UpdatePrivacyInput) {
  return apiFetch("/api/privacy/requests", { method: "PATCH", body: input, schema: resolutionResponseSchema })
}

// The export is a private, no-store attachment. The subject travels in the JSON
// body (never the URL) so it never lands in browser history, proxy logs, or
// referrer headers. Read the blob and trigger a download; never log the subject
// reference.
export async function exportPrivacyData(subject: string): Promise<void> {
  const response = await fetch("/api/privacy/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject }),
  })
  if (!response.ok) {
    let code = "http_error"
    let message = `Request failed (${response.status}).`
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiClientError(response.status, code, message)
  }
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = "privacy-export.json"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}
