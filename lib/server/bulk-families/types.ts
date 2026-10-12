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

/**
 * The reads one preview shares across a listing's changes: each named read
 * (a Google resource, the saved schedule) runs once per listing, and every
 * change of the batch at that listing is planned against that one result.
 * Each caller gets its own copy, so a plan never sees another's edits.
 */
export type PlanReads = {
  once<T>(key: string, read: () => Promise<T>): Promise<T>
  /**
   * What an earlier change of the batch at this listing will make a value
   * (the categories a category change sends): a later change that depends
   * on it (`BULK_PREREQUISITES`) is planned against that, not against what
   * Google holds now. Changes are planned in list order.
   */
  propose(key: string, value: unknown): void
  proposed<T>(key: string): T | undefined
}

/** The categories a batch's category change will give a listing (`PlanReads.propose`). */
export type ProposedCategories = {
  primary: string
  additional: string[]
  /** The service hours types Google offers under them (categories.batchGet, FULL). */
  moreHoursTypes: string[]
  regionCode: string
  languageCode: string
}

/** One claimed child, as the runner hands it to its family. */
export type DispatchContext<TInput extends BulkOperationInput> = {
  organisationId: string
  operationId: string
  childId: string
  locationId: string
  input: TInput
  /** The approver, acting for the batch (lib/server/bulk-listing-runner.ts). */
  session: Session
  /** Who asked for the batch: the author of anything it drafts. */
  requestedBy: string
  linked: GbpLocationContext
  /** Frozen at preview. */
  current: unknown
  proposed: unknown
  updateMask: string[]
  baselineHash: string | null
  /** The receipt's intent: one per child claim (`bulkIntentId`). */
  intentId: string
  /** Which claim of the child this is (1 for the first); earlier claims' intents are `bulkIntentId(childId, n)`. */
  attempt: number
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
export type DispatchOutcome = {
  observed?: unknown
  /**
   * The receipt the child now waits on, when it is an earlier claim's
   * rather than this claim's (a re-claimed child whose earlier write is
   * still unresolved). Defaults to this claim's receipt.
   */
  operationId?: string
} & (
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
    /**
     * The surface's own kill switch, under the env and the operator pause
     * table. Null for a family that sends nothing to Google (post drafts).
     */
    writeSurface: GbpWriteSurface | null
    /** Runs inside the Google account change lock (action links). */
    accountLock: boolean
    /**
     * Read only: the preview of one listing. Reads go through `reads`, which
     * the preview shares across the listing's changes.
     */
    plan(
      input: TInput,
      linked: GbpLocationContext,
      reads: PlanReads
    ): Promise<TargetPlan>
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
    /**
     * Records the settled outcome on the family's own rows (a photo's
     * publication), inside the reconcile transaction, after `undoNotApplied`.
     */
    afterReconcile?(
      sql: TransactionSql,
      child: { organisationId: string; childId: string; locationId: string },
      verdict: ReconcileOutcome
    ): Promise<void>
  }
