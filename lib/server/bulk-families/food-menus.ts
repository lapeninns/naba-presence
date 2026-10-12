import "server-only"

import type { BulkFoodMenusInput } from "@/lib/domain/bulk-menus"
import { applyMenuChange, hashFoodMenus } from "@/lib/domain/food-menus"
import {
  outcomeOfAnsweredWrite,
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import { jsonColumn } from "@/lib/server/db"
import {
  publishFoodMenusChangeLocked,
  readFoodMenusForPlan,
  restoreFoodMenusRevision,
  type FoodMenusRestore,
} from "@/lib/server/food-menus"

/** What a menus child freezes as the listing's current value. */
export type FoodMenusCurrent = {
  googleHash: string
  counts: { menus: number; sections: number; items: number }
}

const countsOf = (menus: Array<Record<string, unknown>>) => {
  const preview = applyMenuChange(
    { operation: "food_menus", mode: "replace", menus },
    []
  )
  return preview.ok
    ? preview.preview.counts
    : { menus: menus.length, sections: 0, items: 0 }
}

/**
 * Food Menus (lib/domain/bulk-menus.ts): a full replacement, or node
 * changes by stable node ID, resolved against the menus Google holds when
 * the preview reads the listing. Nodes are never matched by label. The
 * preview freezes Google's menus hash and lists every node the listing
 * loses (`proposedValue.removed`), adds and updates.
 *
 * Sent through the menu editor's own path (`publishFoodMenusChangeLocked`):
 * the result is saved as a new canonical revision and published as the
 * editor's full replacement (food_menus_sync_attempt), with its receipt,
 * readback and recovery, under the Food Menus lock the editor's publish
 * takes too. A listing whose saved menus hold an unpublished edit is
 * skipped: that edit is its editor's to publish or discard.
 */
export const foodMenusFamily: BulkFamily<BulkFoodMenusInput> = {
  operations: ["food_menus"],
  resourceKey: "food_menus",
  writeSurface: "foodMenus",
  accountLock: false,
  async plan(input, linked, reads) {
    const read = await reads.once("food_menus:menus", () =>
      readFoodMenusForPlan(linked)
    )
    const googleHash = hashFoodMenus(read.googleMenus)
    const current: FoodMenusCurrent = {
      googleHash,
      counts: countsOf(read.googleMenus),
    }
    if (!read.eligible)
      return { eligible: false, reason: "food_menus_not_eligible", current }
    if (read.savedMenus && hashFoodMenus(read.savedMenus) !== googleHash)
      return { eligible: false, reason: "food_menus_local_changes", current }
    const result = applyMenuChange(input, read.googleMenus)
    if (!result.ok) return { eligible: false, reason: result.reason, current }
    if (result.preview.menusHash === googleHash)
      return { eligible: false, reason: "already_applied", current }
    return {
      eligible: true,
      current,
      proposed: result.preview,
      updateMask: ["menus"],
    }
  },
  async dispatch(context) {
    const { input } = context
    const frozen = context.current as FoodMenusCurrent
    try {
      const result = await publishFoodMenusChangeLocked({
        session: context.session,
        locationId: context.locationId,
        apply: (google) => {
          const applied = applyMenuChange(input, google)
          return applied.ok
            ? { ok: true, menus: applied.menus }
            : { ok: false, reason: applied.reason }
        },
        expectedGoogleHash: frozen.googleHash,
        intentId: context.intentId,
        approvalRef: context.approvalRef,
        requestId: context.requestId,
        stillOpen: context.stillOpen,
        // Kept on the child until it settles (the column is the generic
        // restore point of a family that saves a canonical revision first):
        // a write recovery reads back as not applied puts the saved menus
        // back (`undoNotApplied`).
        recordRestore: (sql, restore) => sql`
          update bulk_listing_child set hours_restore = ${jsonColumn(sql, restore)}
          where id = ${context.childId}`,
      })
      const observed = { ...frozen, googleHash: result.googleHash }
      switch (result.status) {
        case "applied":
          return { kind: "succeeded", confirmation: "confirmed", observed }
        case "conflict":
          return { kind: "conflict", code: "google_baseline_changed", observed }
        case "refused":
          return result.reason === "food_menus_local_changes"
            ? { kind: "conflict", code: result.reason, observed }
            : { kind: "failed", code: result.reason, observed }
        case "closed":
          return { kind: "expired" }
        case "published":
          return outcomeOfAnsweredWrite(result.outcome)
      }
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
  },
  reconcile: reconcileFromReceipt,
  async undoNotApplied(sql, child) {
    const [row] = await sql<{ restore: FoodMenusRestore | null }[]>`
      select hours_restore as restore from bulk_listing_child where id = ${child.childId}`
    if (!row?.restore) return {}
    const restored = await restoreFoodMenusRevision(sql, {
      organisationId: child.organisationId,
      locationId: child.locationId,
      restore: row.restore,
    })
    await sql`update bulk_listing_child set hours_restore = null where id = ${child.childId}`
    return { savedRevision: row.restore.revision, restored }
  },
}
