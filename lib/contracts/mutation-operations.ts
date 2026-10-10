/**
 * Shared vocabulary for what happened to a change the product made or tried
 * to make: one outcome state per write, used by the server's mutation
 * receipts and by every surface that reports a write (toasts, publish steps,
 * status pills).
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Copy for each
 * state lives in lib/editors/outcome.ts; this file only fixes the states.
 */
import { z } from "zod"

/**
 * The eight outcomes, in the order a write normally moves through them.
 *
 *   saved_locally          NabaPresence's own copy changed; nothing went to
 *                          Google.
 *   awaiting_approval      A listing change frozen for a second publisher to
 *                          approve (two-person approval, plan P02-S2b);
 *                          nothing went to Google. Approval sends it, and
 *                          it moves on from `sent` like any other write.
 *   sent                   The request left the app; Google has not answered
 *                          in a way that proves anything yet.
 *   awaiting_confirmation  Google accepted the request but has not shown the
 *                          change applied (pending review, propagation).
 *   confirmed_applied      Readback or verification evidence shows Google
 *                          holds the change. The only state that may be
 *                          called "live".
 *   rejected               Google answered and refused the change.
 *   failed                 The request did not complete, and nothing shows
 *                          that Google applied it.
 *   uncertain              The request may or may not have been applied (a
 *                          timeout or an undecodable answer); check Google
 *                          before retrying.
 */
export const OPERATION_OUTCOMES = [
  "saved_locally",
  "awaiting_approval",
  "sent",
  "awaiting_confirmation",
  "confirmed_applied",
  "rejected",
  "failed",
  "uncertain",
] as const

export const operationOutcomeSchema = z.enum(OPERATION_OUTCOMES)
export type OperationOutcome = z.infer<typeof operationOutcomeSchema>

/**
 * The request header that carries a client-minted intent id: one UUID per
 * thing a person asked for, resent unchanged when the client retries after a
 * lost answer. It is the stable operation identity; `x-request-id` stays a
 * per-request correlation id. lib/api/client.ts sends it on every mutation and
 * lib/server/route.ts parses it (400 `invalid_intent_id` when it is not a
 * UUID).
 */
export const INTENT_HEADER = "Idempotency-Key"

export const intentIdSchema = z.uuid()

/**
 * `GET /api/mutations/{id}`: the receipt for one intent. `{id}` is either the
 * operation id or the intent id the client sent, so a client that never saw
 * the answer can still ask what happened to its intent.
 */
export const mutationReceiptSchema = z.object({
  id: z.string(),
  intentId: z.string(),
  surface: z.string(),
  action: z.string(),
  locationId: z.string().nullable(),
  targetType: z.string().nullable(),
  targetRef: z.string().nullable(),
  outcome: operationOutcomeSchema,
  errorCode: z.string().nullable(),
  attemptId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>

export const mutationReceiptResponseSchema = z.object({
  operation: mutationReceiptSchema,
})
export type MutationReceiptResponse = z.infer<
  typeof mutationReceiptResponseSchema
>

/**
 * What every listing mutation route answers with alongside its own fields
 * (`operation` on hours, profile, food menus, business information,
 * industry, media, place actions and post publish): the write's outcome in
 * the shared vocabulary, and the receipt to poll for it.
 *
 * `operationId` is null when the request carried no intent, so no receipt
 * was recorded; `outcome` is then the server's own judgement of this answer.
 * Absent when the route sent nothing to Google (an `in_sync` publish, an
 * import, a post parked for approval).
 */
export const operationSummarySchema = z.object({
  operationId: z.string().nullable(),
  outcome: operationOutcomeSchema,
})
export type OperationSummary = z.infer<typeof operationSummarySchema>

/** The optional `operation` field a mutation response carries. */
export const operationSummaryField = {
  operation: operationSummarySchema.optional(),
}

/**
 * The outcomes a receipt can still move from on its own: a write that has
 * not answered yet (`sent`) and one the recovery job will read back
 * (`uncertain`). A client polls `GET /api/mutations/{id}` while a receipt is
 * in one of these, and stops once it settles.
 */
export const UNSETTLED_OUTCOMES: readonly OperationOutcome[] = [
  "sent",
  "uncertain",
]

export function isUnsettledOutcome(outcome: OperationOutcome): boolean {
  return UNSETTLED_OUTCOMES.includes(outcome)
}

export const mutationReceiptParamsSchema = z.object({ operationId: z.uuid() })
