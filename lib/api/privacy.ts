import { ApiClientError, apiFetch, type RequestOptions } from "./client"
import {
  privacyRequestCreatedResponseSchema,
  privacyRequestResolutionResponseSchema,
  privacyRequestsResponseSchema,
  type PrivacyExportInput,
  type PrivacyRequestCreateInput,
  type UpdatePrivacyInput,
} from "@/lib/contracts/privacy"

export {
  privacyRequestSchema,
  type PrivacyRequest,
  type UpdatePrivacyInput,
} from "@/lib/contracts/privacy"

export function fetchPrivacyRequests(options?: RequestOptions) {
  return apiFetch("/api/privacy/requests", {
    schema: privacyRequestsResponseSchema,
    ...options,
  })
}

// `requestType` is accepted as a plain string here: the card widens its form
// state before calling, and the server validates against the contract enum.
export function createPrivacyRequest(
  input: Omit<PrivacyRequestCreateInput, "requestType"> & { requestType: string }
) {
  return apiFetch("/api/privacy/requests", {
    method: "POST",
    body: input,
    schema: privacyRequestCreatedResponseSchema,
  })
}

export function updatePrivacyRequest(input: UpdatePrivacyInput) {
  return apiFetch("/api/privacy/requests", {
    method: "PATCH",
    body: input,
    schema: privacyRequestResolutionResponseSchema,
  })
}

// The export is a private, no-store attachment. The subject travels in the JSON
// body (never the URL) so it never lands in browser history, proxy logs, or
// referrer headers. Read the blob and trigger a download; never log the subject
// reference.
export async function exportPrivacyData(subject: string): Promise<void> {
  const response = await fetch("/api/privacy/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject } satisfies PrivacyExportInput),
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
