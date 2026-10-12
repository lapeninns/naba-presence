import "server-only"

import type { TransactionSql } from "postgres"

import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import type {
  BulkOperation,
  BulkOperationInput,
  BulkResourceKey,
} from "@/lib/domain/bulk-merge"
import type { GbpWriteSurface } from "@/lib/server/env"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
import type { Session } from "@/lib/server/session"

/** What one listing's preview froze, and what a child re-reads to decide. */
export type TargetPlan =
  | {
      eligible: true
      current: unknown
      proposed: unknown
      updateMask: string[]
    }
  | { eligible: false; reason: string; current?: unknown }

/** One claimed child, as the runner hands it to its family. */
export type DispatchContext<TInput extends BulkOperationInput> = {
  organisationId: string
  operationId: string
  childId: string
  locationId: string
  input: TInput
  /** The approver, acting for the batch (lib/server/bulk-listing-runner.ts). */
  session: Session
  linked: GbpLocationContext
  /** Frozen at preview. */
  current: unknown
  proposed: unknown
  updateMask: string[]
  baselineHash: string | null
  /** The receipt's intent: one per child claim (`bulkIntentId`). */
  intentId: string
  /** Recorded on the receipt: `bulk_listing_operation:<id>`. */
  approvalRef: string
  requestId: string
  /** The dispatch window (24 hours after approval) is still open. */
  stillOpen: () => boolean
}

/**
 * How a dispatch ended. `observed` is the listing's relevant Google value
 * when the family read it, stored on the child as its current value.
 */
export type DispatchOutcome = { observed?: unknown } & (
  | { kind: "succeeded"; confirmation: "confirmed" | "unrecorded" }
  | { kind: "conflict"; code: string }
  | { kind: "expired" }
  | { kind: "deferred"; code: string }
  | { kind: "failed"; code: string }
  | { kind: "ambiguous"; code: string }
)

/** How a child left `ambiguous` settles once its receipt has. */
export type ReconcileOutcome =
  | { kind: "succeeded"; confirmation: "confirmed" | "unrecorded" }
  | { kind: "failed"; code: string }

/**
 * One family of listing change: how a preview plans a listing, how a
 * claimed child is sent through the surface's write pipeline with a receipt,
 * and how an unresolved child settles from that receipt.
 */
export type BulkFamily<TInput extends BulkOperationInput = BulkOperationInput> =
  {
    operations: readonly BulkOperation[]
    resourceKey: BulkResourceKey
    /** The surface's own kill switch, under the env and the operator pause table. */
    writeSurface: GbpWriteSurface
    /** Runs inside the Google account change lock (action links). */
    accountLock: boolean
    /** Read only: the preview of one listing. */
    plan(input: TInput, linked: GbpLocationContext): Promise<TargetPlan>
    /**
     * At most one provider write, under the resource lock the runner holds,
     * after rechecking the frozen baseline. Throws only for errors the runner
     * maps itself (an ApiError's code).
     */
    dispatch(context: DispatchContext<TInput>): Promise<DispatchOutcome>
    reconcile(receipt: {
      state: OperationOutcome
      errorCode: string | null
      /** The attempt's status as the receipt recorded it. */
      attemptStatus: string | null
    }): ReconcileOutcome | null
    /**
     * Undoes what the dispatch saved locally for a write the receipt now
     * says did not apply, inside the reconcile transaction. Returns audit
     * metadata.
     */
    undoNotApplied?(
      sql: TransactionSql,
      child: { organisationId: string; childId: string; locationId: string }
    ): Promise<Record<string, unknown>>
  }
