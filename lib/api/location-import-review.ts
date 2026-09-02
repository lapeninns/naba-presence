import {
  importConfirmationFor,
  importReviewCountsResponseSchema,
  importReviewDecisionResponseSchema,
  importReviewListResponseSchema,
  importReviewRefreshResponseSchema,
  type ImportProposal,
  type ImportReviewDecisionRequest,
  type ImportReviewListResponse,
  type ImportReviewRefreshScope,
} from "@/lib/contracts/location-import-review"
import type { ProposalResourceType } from "@/lib/domain/import-review"

import { apiFetch, type RequestOptions } from "./client"

// Shapes live in lib/contracts/location-import-review.ts; re-exported for
// existing importers.
export type { ImportProposal }
export type ImportReviewList = ImportReviewListResponse

export function fetchImportReview(
  id: string,
  resourceType?: ProposalResourceType,
  options?: RequestOptions
): Promise<ImportReviewList> {
  const query = resourceType ? `?resourceType=${resourceType}` : ""
  return apiFetch(`/api/locations/${id}/import-review${query}`, {
    schema: importReviewListResponseSchema,
    ...options,
  })
}

export function refreshImportReview(
  id: string,
  resourceType: ImportReviewRefreshScope = "all"
) {
  return apiFetch(`/api/locations/${id}/import-review/refresh`, {
    method: "POST",
    body: { resourceType },
    schema: importReviewRefreshResponseSchema,
  })
}

export type DecideProposalInput = {
  action: ImportReviewDecisionRequest["action"]
  resourceType: ProposalResourceType
  expectedCanonicalRevision: string
  confirmOverwriteCanonicalChanges?: boolean
}

export function decideImportProposal(
  id: string,
  proposalId: string,
  input: DecideProposalInput
) {
  const body: ImportReviewDecisionRequest = {
    action: input.action,
    confirmation: importConfirmationFor(input.resourceType),
    expectedCanonicalRevision: input.expectedCanonicalRevision,
    confirmOverwriteCanonicalChanges:
      input.confirmOverwriteCanonicalChanges ?? false,
  }
  return apiFetch(`/api/locations/${id}/import-review/${proposalId}/decision`, {
    method: "POST",
    body,
    schema: importReviewDecisionResponseSchema,
  })
}

export function fetchImportReviewCounts(options?: RequestOptions) {
  return apiFetch("/api/import-review/counts", {
    schema: importReviewCountsResponseSchema,
    ...options,
  })
}
