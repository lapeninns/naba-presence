import "server-only"

import {
  lodgingApplied,
  lodgingCurrent,
  lodgingProposed,
  lodgingSendBody,
  type BulkLodgingInput,
} from "@/lib/domain/bulk-lodging"
import { comparisonHash } from "@/lib/server/bulk-families/compare"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import { runBulkWrite } from "@/lib/server/bulk-families/write-attempts"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
import { googleLodgingApi } from "@/lib/server/google"
import { isConnectionBlockedError } from "@/lib/server/google/connection-failures"
import { ApiError } from "@/lib/server/http"

async function readLodging(linked: GbpLocationContext) {
  return googleLodgingApi(
    await linked.accessToken(),
    { locationName: linked.googleLocationName, operation: "get" },
    { connectionKey: linked.connectionId }
  )
}

/**
 * Whether Google keeps no lodging resource for the listing: its 404 for the
 * lodging read. A 404 from loading the listing's Google connection (a
 * disconnected connection) is a connection error, not a missing resource.
 */
export function lodgingNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    !isConnectionBlockedError(error)
  )
}

/**
 * The industry family: lodging, as a typed field-mask patch
 * (lib/domain/bulk-lodging.ts). Paths come from the typed lodging allowlist
 * and values from the typed lodging schema; only those paths are frozen and
 * compared, a cleared path must read back empty and a `false` must read
 * back `false`. A listing Google keeps no lodging resource for is skipped.
 * Sent through runGbpWrite under the lodging editor's lock
 * (`<org>:<location>:lodging`), with `metadata.updateTime` stamped at the
 * send, as the editor stamps it. Healthcare is not a bulk family (pending
 * decision D-24).
 */
export const lodgingFamily: BulkFamily<BulkLodgingInput> = {
  operations: ["lodging"],
  resourceKey: "lodging",
  writeSurface: "profileWrites",
  accountLock: false,
  async plan(input, linked, reads) {
    let lodging: Record<string, unknown>
    try {
      lodging = await reads.once("lodging", () => readLodging(linked))
    } catch (error) {
      if (lodgingNotFound(error))
        return { eligible: false, reason: "lodging_not_available" }
      throw error
    }
    const current = lodgingCurrent(input, lodging)
    if (lodgingApplied(lodging, input))
      return { eligible: false, reason: "already_applied", current }
    return {
      eligible: true,
      current,
      proposed: lodgingProposed(input),
      updateMask: [...input.updateMask].sort(),
    }
  },
  async dispatch(context) {
    const { linked, input } = context
    let observed: Record<string, unknown>
    try {
      observed = await readLodging(linked)
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
    const current = lodgingCurrent(input, observed)
    if (lodgingApplied(observed, input))
      return { kind: "succeeded", confirmation: "confirmed", observed: current }
    if (comparisonHash(current) !== comparisonHash(context.current))
      return {
        kind: "conflict",
        code: "google_baseline_changed",
        observed: current,
      }
    if (!context.stillOpen()) return { kind: "expired" }
    return runBulkWrite(context, {
      family: "lodging",
      surface: "lodging",
      action: "update_lodging",
      writeSurface: "profileWrites",
      // The stamp is not part of what is compared, so the attempt key stays
      // the same for every claim of this child.
      intended: {
        updateMask: input.updateMask,
        clear: input.clear,
        payload: input.payload,
      },
      mutate: async () =>
        googleLodgingApi(
          await linked.accessToken(),
          {
            locationName: linked.googleLocationName,
            operation: "patch",
            ...lodgingSendBody(input, new Date()),
          },
          { connectionKey: linked.connectionId }
        ),
      read: () => readLodging(linked),
      verify: (readback) => lodgingApplied(readback, input),
    })
  },
  reconcile: reconcileFromReceipt,
}
