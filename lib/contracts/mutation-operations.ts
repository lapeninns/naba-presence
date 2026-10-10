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
 * The seven outcomes, in the order a write normally moves through them.
 *
 *   saved_locally          NabaPresence's own copy changed; nothing went to
 *                          Google.
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
  "sent",
  "awaiting_confirmation",
  "confirmed_applied",
  "rejected",
  "failed",
  "uncertain",
] as const

export const operationOutcomeSchema = z.enum(OPERATION_OUTCOMES)
export type OperationOutcome = z.infer<typeof operationOutcomeSchema>
