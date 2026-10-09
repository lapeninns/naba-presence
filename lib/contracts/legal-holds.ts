/**
 * Wire contract for `/api/legal-holds`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The route parses
 * POST/DELETE bodies with the request schemas and shapes replies with the
 * response ones.
 *
 * The route is now the only consumer: its browser-side wrapper went with the
 * compliance console.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/legal-holds` body. */
export const legalHoldCreateSchema = z.object({
  reviewId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
})
export type LegalHoldCreateInput = z.infer<typeof legalHoldCreateSchema>

/** DELETE `/api/legal-holds` body. */
export const legalHoldReleaseSchema = z.object({ reviewId: z.uuid() })
export type LegalHoldReleaseInput = z.infer<typeof legalHoldReleaseSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const legalHoldSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  reason: z.string(),
  approvedBy: z.string(),
  releasedBy: z.string().nullable(),
  releasedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type LegalHold = z.infer<typeof legalHoldSchema>

/** GET `/api/legal-holds` response. */
export const legalHoldsResponseSchema = z.object({ holds: z.array(legalHoldSchema) })
export type LegalHoldsResponse = z.infer<typeof legalHoldsResponseSchema>

/** POST `/api/legal-holds` response (201). */
export const legalHoldCreatedResponseSchema = z.object({
  hold: z.object({
    id: z.string(),
    reviewId: z.string(),
    reason: z.string(),
    approvedBy: z.string(),
    createdAt: z.string(),
  }),
})
export type LegalHoldCreatedResponse = z.infer<typeof legalHoldCreatedResponseSchema>

/** DELETE `/api/legal-holds` response. */
export const legalHoldReleasedResponseSchema = z.object({ released: z.literal(true) })
export type LegalHoldReleasedResponse = z.infer<typeof legalHoldReleasedResponseSchema>
