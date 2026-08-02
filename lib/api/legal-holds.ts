import { z } from "zod"

import { apiFetch } from "./client"

export const legalHoldSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  reason: z.string(),
  approvedBy: z.string(),
  releasedBy: z.string().nullable(),
  releasedAt: z.string().nullable(),
  createdAt: z.string(),
})

const holdsResponseSchema = z.object({ holds: z.array(legalHoldSchema) })
const createResponseSchema = z.object({
  hold: z.object({
    id: z.string(),
    reviewId: z.string(),
    reason: z.string(),
    approvedBy: z.string(),
    createdAt: z.string(),
  }),
})
const releasedResponseSchema = z.object({ released: z.literal(true) })

export type LegalHold = z.infer<typeof legalHoldSchema>

export function fetchLegalHolds() {
  return apiFetch("/api/legal-holds", { schema: holdsResponseSchema })
}

export function createLegalHold(input: { reviewId: string; reason: string }) {
  return apiFetch("/api/legal-holds", { method: "POST", body: input, schema: createResponseSchema })
}

export function releaseLegalHold(reviewId: string) {
  return apiFetch("/api/legal-holds", { method: "DELETE", body: { reviewId }, schema: releasedResponseSchema })
}
