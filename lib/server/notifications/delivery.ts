import "server-only"

import { log } from "@/lib/server/logger"
import { isScopeEnabled, type PauseScope } from "@/lib/server/pause-controls"

import type { SendResult } from "./email"

/**
 * The one delivery driver behind every outbound email queue: tenant
 * notifications (notification_delivery), operator alerts
 * (platform_incident_delivery) and, later, invitations. Each queue owns its
 * table, its claim and its message; this module owns what a send's result
 * means for the row.
 *
 * The contract every queue keeps:
 *   - claim BEFORE send: the claim is a committed write that counts the
 *     attempt and pushes next_attempt_at out, so a crash mid-send only delays
 *     the retry;
 *   - every send carries the row's own idempotency key;
 *   - the settle is conditional on the row still being pending.
 *
 * States: sent (the provider accepted it), suppressed (deliberately not
 * sent), failed (the provider certainly did not accept it, and will not on a
 * retry), uncertain (it may have gone out and no safe retry is left), and
 * pending (due again later).
 */

export type DeliveryStatus =
  "pending" | "sent" | "failed" | "suppressed" | "uncertain"

/** notification_delivery.delivery_state the first settle moves `queued` to. */
export type DeliveryEvidence =
  "queued" | "accepted" | "suppressed" | "failed" | "unknown"

export type Settlement = {
  status: DeliveryStatus
  evidence: DeliveryEvidence
  errorCode: string | null
  providerMessageId: string | null
  /** Minutes until the next attempt; set only when status is pending. */
  retryInMinutes: number | null
}

export const MAX_DELIVERY_ATTEMPTS = 5

/**
 * How long a retry with the same idempotency key is still answered from the
 * provider's record of the first send (Resend keeps keys for 24 hours; 23
 * here for margin). Past it, a retry of an uncertain send could email twice.
 */
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000

export type ClaimedAttempt = {
  /** The attempt count after this claim (1 on the first send). */
  attempts: number
  /** When the row was queued, which bounds its idempotency window. */
  createdAt: Date
}

/**
 * What a send's result means for its row. Pure.
 *
 * A retryable refusal is retried with back-off up to the attempt limit, then
 * failed. An uncertain send is retried only while the idempotency key still
 * protects it (the provider answers a repeat with the first send); once the
 * limit or the window is spent it settles uncertain, never failed: a timeout
 * after the request went out is not evidence that nobody was emailed.
 */
export function settleSend(
  result: SendResult,
  attempt: ClaimedAttempt,
  options: { maxAttempts?: number; now?: Date } = {}
): Settlement {
  const maxAttempts = options.maxAttempts ?? MAX_DELIVERY_ATTEMPTS
  const now = options.now ?? new Date()
  const backoff = 2 ** attempt.attempts
  const canRetry = attempt.attempts < maxAttempts
  switch (result.status) {
    case "sent":
      return {
        status: "sent",
        evidence: "accepted",
        errorCode: null,
        providerMessageId: result.providerMessageId,
        retryInMinutes: null,
      }
    case "suppressed":
      return {
        status: "suppressed",
        evidence: "suppressed",
        errorCode: result.reason,
        providerMessageId: null,
        retryInMinutes: null,
      }
    case "failed":
      return result.retryable && canRetry
        ? {
            status: "pending",
            evidence: "queued",
            errorCode: result.code,
            providerMessageId: null,
            retryInMinutes: backoff,
          }
        : {
            status: "failed",
            evidence: "failed",
            errorCode: result.code,
            providerMessageId: null,
            retryInMinutes: null,
          }
    case "uncertain": {
      const protectedRetry =
        now.getTime() - attempt.createdAt.getTime() < IDEMPOTENCY_WINDOW_MS
      return canRetry && protectedRetry
        ? {
            status: "pending",
            evidence: "queued",
            errorCode: result.code,
            providerMessageId: null,
            retryInMinutes: backoff,
          }
        : {
            status: "uncertain",
            evidence: "unknown",
            errorCode: result.code,
            providerMessageId: null,
            retryInMinutes: null,
          }
    }
  }
}

export type DeliveryOutcome = {
  sent: number
  suppressed: number
  /** Refused sends, final or due again. */
  failed: number
  /** Sends whose fate is unknown, final or due again. */
  uncertain: number
}

export function emptyOutcome(): DeliveryOutcome {
  return { sent: 0, suppressed: 0, failed: 0, uncertain: 0 }
}

export type DeliveryQueue<T extends ClaimedAttempt & { id: string }> = {
  /** For logs: which queue a failure came from. */
  name: string
  /**
   * Pause scopes checked before anything is claimed (lib/server/
   * pause-controls.ts). A paused scope, or an unreadable pause table, claims
   * nothing: the rows stay pending and go out after the pause lifts.
   */
  scopes?: readonly PauseScope[]
  /** Claims due rows (attempt counted, next attempt pushed out), committed. */
  claim: () => Promise<T[]>
  /**
   * Sends one claimed row with its idempotency key. A recheck that decides
   * the row must not go out returns `{ status: "suppressed" }`.
   */
  send: (item: T) => Promise<SendResult>
  /** Writes the settlement, only while the row is still pending. */
  settle: (item: T, settlement: Settlement) => Promise<void>
  maxAttempts?: number
  /** Extra log fields for a failed or uncertain row. */
  logContext?: (item: T) => Record<string, unknown>
}

/** Claims, sends and settles what is due on one queue. */
export async function runDeliveries<T extends ClaimedAttempt & { id: string }>(
  queue: DeliveryQueue<T>
): Promise<DeliveryOutcome & { paused: boolean }> {
  const outcome = emptyOutcome()
  if (queue.scopes?.length && !(await isScopeEnabled(queue.scopes))) {
    return { ...outcome, paused: true }
  }
  const claimed = await queue.claim()
  for (const item of claimed) {
    const result = await queue.send(item)
    const settlement = settleSend(result, item, {
      maxAttempts: queue.maxAttempts,
    })
    const counted =
      result.status === "sent"
        ? "sent"
        : result.status === "suppressed"
          ? "suppressed"
          : result.status === "uncertain"
            ? "uncertain"
            : "failed"
    outcome[counted] += 1
    await queue.settle(item, settlement)
    if (counted === "failed" || counted === "uncertain") {
      log.warn("notifications.delivery_failed", {
        queue: queue.name,
        deliveryId: item.id,
        errorCode: settlement.errorCode,
        status: settlement.status,
        willRetry: settlement.status === "pending",
        ...queue.logContext?.(item),
      })
    }
  }
  return { ...outcome, paused: false }
}
