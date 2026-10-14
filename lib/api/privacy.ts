import {
  legalHoldCreatedResponseSchema,
  legalHoldReleasedResponseSchema,
  legalHoldsResponseSchema,
  type LegalHoldCreateInput,
} from "@/lib/contracts/legal-holds"
import {
  privacyErasurePreviewResponseSchema,
  privacyExportResponseSchema,
  privacyRequestCreatedResponseSchema,
  privacyRequestResolutionResponseSchema,
  privacyRequestsResponseSchema,
  retentionStatusResponseSchema,
  type PrivacyExportInput,
  type PrivacyRequestCreateInput,
  type UpdatePrivacyInput,
} from "@/lib/contracts/privacy"

import { apiFetch, type RequestOptions } from "./client"

export type { LegalHold } from "@/lib/contracts/legal-holds"
export type {
  PrivacyErasurePreview,
  PrivacyExportResponse,
  PrivacyRequest,
  RetentionCycleSummary,
  RetentionStatusResponse,
} from "@/lib/contracts/privacy"

export function fetchPrivacyRequests(options?: RequestOptions) {
  return apiFetch("/api/privacy/requests", {
    schema: privacyRequestsResponseSchema,
    ...options,
  })
}

export function createPrivacyRequest(input: PrivacyRequestCreateInput) {
  return apiFetch("/api/privacy/requests", {
    method: "POST",
    body: input,
    schema: privacyRequestCreatedResponseSchema,
  })
}

/** Fulfil, or move to a status (reject, mark in progress). Owners only. */
export function updatePrivacyRequest(input: UpdatePrivacyInput) {
  return apiFetch("/api/privacy/requests", {
    method: "PATCH",
    body: input,
    schema: privacyRequestResolutionResponseSchema,
  })
}

/** What fulfilling a request would touch; owners only. */
export function fetchPrivacyPreview(id: string, options?: RequestOptions) {
  return apiFetch(`/api/privacy/requests/${encodeURIComponent(id)}/preview`, {
    schema: privacyErasurePreviewResponseSchema,
    ...options,
  })
}

export function fetchLegalHolds(options?: RequestOptions) {
  return apiFetch("/api/legal-holds", {
    schema: legalHoldsResponseSchema,
    ...options,
  })
}

export function createLegalHold(input: LegalHoldCreateInput) {
  return apiFetch("/api/legal-holds", {
    method: "POST",
    body: input,
    schema: legalHoldCreatedResponseSchema,
  })
}

export function releaseLegalHold(reviewId: string) {
  return apiFetch("/api/legal-holds", {
    method: "DELETE",
    body: { reviewId },
    schema: legalHoldReleasedResponseSchema,
  })
}

/**
 * One page of a subject export. The subject travels in the body, never the
 * URL; follow `nextCursor` until it is null.
 */
export function exportPrivacyPage(
  input: PrivacyExportInput,
  options?: RequestOptions
) {
  return apiFetch("/api/privacy/export", {
    method: "POST",
    body: input,
    schema: privacyExportResponseSchema,
    ...options,
  })
}

export function fetchRetentionStatus(options?: RequestOptions) {
  return apiFetch("/api/privacy/retention-status", {
    schema: retentionStatusResponseSchema,
    ...options,
  })
}
