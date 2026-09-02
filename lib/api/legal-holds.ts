import { apiFetch, type RequestOptions } from "./client"
import {
  legalHoldCreatedResponseSchema,
  legalHoldReleasedResponseSchema,
  legalHoldsResponseSchema,
  type LegalHoldCreateInput,
  type LegalHoldReleaseInput,
} from "@/lib/contracts/legal-holds"

export { legalHoldSchema, type LegalHold } from "@/lib/contracts/legal-holds"

export function fetchLegalHolds(options?: RequestOptions) {
  return apiFetch("/api/legal-holds", { schema: legalHoldsResponseSchema, ...options })
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
    body: { reviewId } satisfies LegalHoldReleaseInput,
    schema: legalHoldReleasedResponseSchema,
  })
}
