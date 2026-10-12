import "server-only"

import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import type {
  DispatchOutcome,
  PlanReads,
  ReconcileOutcome,
} from "@/lib/server/bulk-families/types"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

/**
 * The receipt intent for one claim of one child: the same claim always maps
 * to the same intent, so a write the runner re-enters (a crashed tick, a
 * second runner) joins its receipt instead of sending again. A later claim
 * (a retry, or a child deferred before it sent anything) is a new intent;
 * the surface's own idempotency key still finds an earlier uncertain write
 * and reads it back before sending.
 */
export function bulkIntentId(childId: string, attempt: number): string {
  return uuidFromSeed(`bulk_listing_child:${childId}:${attempt}`)
}

/** A stable UUID for a seed: the same seed always names the same row. */
export function uuidFromSeed(seed: string): string {
  const hex = sha256(seed)
  // RFC 9562 layout: version 8 (custom), variant 10.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-")
}

/**
 * A fresh read cache for one listing of one preview (`PlanReads`): the
 * first call of a key starts the read, later calls (also concurrent ones)
 * join it, and a failed read fails every change that needed it, with the
 * same reason. Results are cloned per caller.
 */
export function planReads(): PlanReads {
  const started = new Map<string, Promise<unknown>>()
  const proposals = new Map<string, unknown>()
  return {
    propose(key, value) {
      proposals.set(key, structuredClone(value))
    },
    proposed<T>(key: string) {
      return proposals.has(key)
        ? (structuredClone(proposals.get(key)) as T)
        : undefined
    },
    async once<T>(key: string, read: () => Promise<T>) {
      let pending = started.get(key) as Promise<T> | undefined
      if (!pending) {
        pending = read()
        started.set(key, pending)
      }
      return structuredClone(await pending)
    },
  }
}

export const bulkApprovalRef = (operationId: string) =>
  `bulk_listing_operation:${operationId}`

export type Receipt = {
  id: string
  state: OperationOutcome
  errorCode: string | null
}

/** The receipt recorded under `intentId`, if the write got that far. */
export async function receiptFor(
  organisationId: string,
  intentId: string
): Promise<Receipt | null> {
  const [row] = await withTenant(
    organisationId,
    (sql) => sql<Receipt[]>`
      select id::text as id, state, error_code as "errorCode"
      from mutation_operation
      where organisation_id = ${organisationId} and intent_id = ${intentId}`
  )
  return row ?? null
}

const isPaused = (error: ApiError) =>
  typeof error.details === "object" &&
  error.details !== null &&
  "pausedScopes" in error.details

/**
 * What a pipeline write that threw means for the child. The receipt is the
 * record of what happened at Google: `uncertain` (or still `sent`) waits for
 * recovery, a settled failure is final for this claim. Without a receipt the
 * write never reached the attempt row, so nothing was sent.
 */
export async function outcomeOfThrownWrite(
  organisationId: string,
  intentId: string,
  error: unknown
): Promise<DispatchOutcome> {
  const receipt = await receiptFor(organisationId, intentId)
  const code =
    error instanceof ApiError ? error.code : "google_confirmation_unresolved"
  // Quota pressure, however Google worded it (a validateOnly call is not
  // classified as a mutation by the transport).
  const rateLimited =
    code === "google_rate_limited" ||
    (error instanceof ApiError && error.status === 429)
  if (!receipt) {
    if (error instanceof GoogleMutationAmbiguousError)
      return { kind: "ambiguous", code: "response_ambiguous" }
    if (!(error instanceof ApiError)) throw error
    if (rateLimited) return { kind: "deferred", code: "google_rate_limited" }
    if (isPaused(error)) return { kind: "deferred", code: "publishing_paused" }
    return { kind: "failed", code }
  }
  switch (receipt.state) {
    case "confirmed_applied":
      return { kind: "succeeded", confirmation: "confirmed" }
    case "awaiting_confirmation":
      return { kind: "succeeded", confirmation: "unrecorded" }
    case "failed":
    case "rejected":
      // Google refused or the write was not applied: final for this claim,
      // except quota pressure, which a later claim may send again.
      if (rateLimited) return { kind: "deferred", code: "google_rate_limited" }
      return { kind: "failed", code: `provider_rejected:${code}` }
    default:
      return {
        kind: "ambiguous",
        code:
          error instanceof GoogleMutationAmbiguousError
            ? "response_ambiguous"
            : "readback_failed",
      }
  }
}

/**
 * What a write the pipeline answered (rather than threw) means for the
 * child, the same for every family. `rejected` there is only ever a
 * replayed receipt on a succeeded attempt: Google holds the change and
 * does not show it (lib/server/gbp-write.ts `replayReceipt`), so it landed,
 * unconfirmed. Anything not yet settled waits for recovery.
 */
export function outcomeOfAnsweredWrite(
  outcome: OperationOutcome
): DispatchOutcome {
  switch (outcome) {
    case "confirmed_applied":
      return { kind: "succeeded", confirmation: "confirmed" }
    case "awaiting_confirmation":
    case "rejected":
      return { kind: "succeeded", confirmation: "unrecorded" }
    case "failed":
      return { kind: "failed", code: "provider_rejected" }
    default:
      return { kind: "ambiguous", code: "readback_failed" }
  }
}

/**
 * The shared reconcile: an unresolved child follows its receipt once
 * recovery (lib/server/mutation-recovery.ts) has read Google back. It is
 * never sent again from here. A `rejected` receipt whose attempt succeeded
 * landed (see `outcomeOfAnsweredWrite`).
 */
export function reconcileFromReceipt(receipt: {
  state: OperationOutcome
  errorCode: string | null
  attemptStatus?: string | null
}): ReconcileOutcome | null {
  switch (receipt.state) {
    case "confirmed_applied":
      return { kind: "succeeded", confirmation: "confirmed" }
    case "awaiting_confirmation":
      return { kind: "succeeded", confirmation: "unrecorded" }
    case "rejected":
      if (receipt.attemptStatus === "succeeded")
        return { kind: "succeeded", confirmation: "unrecorded" }
      return {
        kind: "failed",
        code: `recovered_not_applied${receipt.errorCode ? `:${receipt.errorCode}` : ""}`,
      }
    case "failed":
      return {
        kind: "failed",
        code: `recovered_not_applied${receipt.errorCode ? `:${receipt.errorCode}` : ""}`,
      }
    default:
      return null
  }
}
