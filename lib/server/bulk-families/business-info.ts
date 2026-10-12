import "server-only"

import {
  businessInfoApplied,
  businessInfoCurrent,
  businessInfoPatch,
  businessInfoProposed,
  type BulkBusinessInfoInput,
} from "@/lib/domain/bulk-business-info"
import { comparisonHash } from "@/lib/server/bulk-families/compare"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import {
  BUSINESS_LOCATION_FIELDS,
  runBulkWrite,
} from "@/lib/server/bulk-families/write-attempts"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
import { getGoogleLocation, patchGoogleLocation } from "@/lib/server/google"

/** The listing's business-information fields this family and categories compare. */
export async function readBusinessLocation(linked: GbpLocationContext) {
  return getGoogleLocation(
    await linked.accessToken(),
    linked.googleLocationName,
    [...BUSINESS_LOCATION_FIELDS],
    { connectionKey: linked.connectionId }
  )
}

/**
 * Business information as a field-mask patch (lib/domain/bulk-business-info.ts):
 * only the named fields are sent, each set or explicitly cleared, and only
 * those fields are frozen at preview and compared at dispatch, so an edit
 * to another field of the listing is never a conflict. Provider-owned and
 * per-listing fields are not offered at all. Sent through runGbpWrite with
 * Google's validateOnly check first, under the location's
 * business-information lock (`<org>:<location>:business_info`), which the
 * business-information editor and the profile publisher (lib/server/profile.ts,
 * website and description) also take, so none of them interleaves with a
 * bulk child. A bulk website or description write goes to Google directly,
 * not through the canonical profile, so the profile editor afterwards shows
 * those fields as changed on Google until it is refreshed.
 */
export const businessInfoFamily: BulkFamily<BulkBusinessInfoInput> = {
  operations: ["business_info"],
  resourceKey: "business_info",
  writeSurface: "profileWrites",
  accountLock: false,
  async plan(input, linked, reads) {
    const location = await reads.once("business_info:location", () =>
      readBusinessLocation(linked)
    )
    const current = businessInfoCurrent(input, location)
    // Reopening a permanently closed listing is a decision for that
    // listing's own editor, never a side effect of a batch.
    if (
      input.changes.some((change) => change.field === "openInfo.status") &&
      current["openInfo.status"] === "CLOSED_PERMANENTLY"
    )
      return { eligible: false, reason: "permanently_closed", current }
    if (businessInfoApplied(location, input.changes))
      return { eligible: false, reason: "already_applied", current }
    return {
      eligible: true,
      current,
      proposed: businessInfoProposed(input),
      updateMask: businessInfoPatch(input).updateMask,
    }
  },
  async dispatch(context) {
    const { linked, input } = context
    let observed: Record<string, unknown>
    try {
      observed = await readBusinessLocation(linked)
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
    const current = businessInfoCurrent(input, observed)
    if (businessInfoApplied(observed, input.changes))
      return { kind: "succeeded", confirmation: "confirmed", observed: current }
    if (comparisonHash(current) !== comparisonHash(context.current))
      return {
        kind: "conflict",
        code: "google_baseline_changed",
        observed: current,
      }
    if (!context.stillOpen()) return { kind: "expired" }
    const patch = businessInfoPatch(input)
    const send = async (validateOnly: boolean) =>
      patchGoogleLocation(
        await linked.accessToken(),
        {
          locationName: linked.googleLocationName,
          updateMask: patch.updateMask,
          validateOnly,
          payload: patch.payload,
        },
        { connectionKey: linked.connectionId }
      )
    return runBulkWrite(context, {
      family: "business_info",
      surface: "business_info",
      action: "update",
      writeSurface: "profileWrites",
      intended: { changes: input.changes },
      validate: () => send(true),
      mutate: () => send(false),
      read: () => readBusinessLocation(linked),
      verify: (readback) => businessInfoApplied(readback, input.changes),
    })
  },
  reconcile: reconcileFromReceipt,
}
