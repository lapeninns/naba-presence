import { z } from "zod"

import { apiFetch } from "./client"
import { verificationSchema } from "./reviews"

const draftResultSchema = z.object({
  draftId: z.string(),
  body: z.string(),
  bodyBytes: z.number(),
  evidenceHash: z.string().nullable(),
  verification: verificationSchema,
})
export type DraftResult = z.infer<typeof draftResultSchema>

// One endpoint is Generate/Regenerate/Save. Omit `body` -> the server
// generates (AI) or templates (rating-only); include `body` -> human edit.
export type DraftInput = {
  tone?: "warm_professional" | "concise" | "empathetic"
  languageOverride?: string | null
  body?: string
}

export function generateOrSaveDraft(reviewId: string, input: DraftInput) {
  return apiFetch(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: input,
    schema: draftResultSchema,
  })
}

const verifyResultSchema = z.object({ verification: verificationSchema })
export type VerifyResult = z.infer<typeof verifyResultSchema>

export function verifyDraft(draftId: string) {
  return apiFetch(`/api/drafts/${draftId}/verify`, {
    method: "POST",
    schema: verifyResultSchema,
  })
}
