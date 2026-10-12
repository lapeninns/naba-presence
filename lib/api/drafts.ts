import {
  draftResultSchema,
  verifyResultSchema,
  type DraftInput,
} from "@/lib/contracts/reviews"

import { apiFetch, type MutationOptions } from "./client"

export type { DraftInput, DraftResult, VerifyResult } from "@/lib/contracts/reviews"

// One endpoint is Generate / Regenerate / Save (see draftInputSchema). The
// intent is the generation id: resent unchanged on a retry, the server
// answers from the first generation instead of spending a second credit.
export function generateOrSaveDraft(
  reviewId: string,
  input: DraftInput,
  options: MutationOptions = {}
) {
  return apiFetch(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: input,
    schema: draftResultSchema,
    intentId: options.intentId,
  })
}

export function verifyDraft(draftId: string) {
  return apiFetch(`/api/drafts/${draftId}/verify`, {
    method: "POST",
    schema: verifyResultSchema,
  })
}
