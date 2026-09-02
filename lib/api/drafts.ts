import {
  draftResultSchema,
  verifyResultSchema,
  type DraftInput,
} from "@/lib/contracts/reviews"

import { apiFetch } from "./client"

export type { DraftInput, DraftResult, VerifyResult } from "@/lib/contracts/reviews"

// One endpoint is Generate / Regenerate / Save (see draftInputSchema).
export function generateOrSaveDraft(reviewId: string, input: DraftInput) {
  return apiFetch(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: input,
    schema: draftResultSchema,
  })
}

export function verifyDraft(draftId: string) {
  return apiFetch(`/api/drafts/${draftId}/verify`, {
    method: "POST",
    schema: verifyResultSchema,
  })
}
