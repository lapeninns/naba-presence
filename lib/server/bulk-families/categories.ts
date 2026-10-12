import "server-only"

import { z } from "zod"

import {
  categoriesPayload,
  categoryIds,
  mergeCategories,
  sameCategories,
  type BulkCategoriesInput,
  type CategoryIds,
} from "@/lib/domain/bulk-business-info"
import { isRecord } from "@/lib/domain/readback/compare"
import { readBusinessLocation } from "@/lib/server/bulk-families/business-info"
import { comparisonHash } from "@/lib/server/bulk-families/compare"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type {
  BulkFamily,
  ProposedCategories,
} from "@/lib/server/bulk-families/types"
import { runBulkWrite } from "@/lib/server/bulk-families/write-attempts"
import {
  batchGetGoogleCategories,
  patchGoogleLocation,
} from "@/lib/server/google"

const batchSchema = z.object({
  categories: z
    .array(
      z.looseObject({
        name: z.string(),
        moreHoursTypes: z
          .array(z.looseObject({ hoursTypeId: z.string() }))
          .optional(),
      })
    )
    .optional(),
})

/** The region Google files the listing's categories under. */
function regionOf(location: Record<string, unknown>): string | null {
  for (const field of ["storefrontAddress", "serviceArea"] as const) {
    const value = location[field]
    if (isRecord(value) && typeof value.regionCode === "string")
      return value.regionCode
  }
  return null
}

/**
 * Categories by stable ID: a new primary, and additional categories added
 * or removed, with the rest kept as each listing has them. Each listing's
 * resulting categories are checked against Google's category list for its
 * region (categories.batchGet), and what they offer (service hours types,
 * attributes) is handed to the batch's later changes at that listing, which
 * wait for this one to apply (`BULK_PREREQUISITES`). Sent like business
 * information: the `categories` mask through runGbpWrite, under the same
 * lock.
 */
export const categoriesFamily: BulkFamily<BulkCategoriesInput> = {
  operations: ["categories"],
  resourceKey: "business_info",
  writeSurface: "profileWrites",
  accountLock: false,
  async plan(input, linked, reads) {
    const location = await reads.once("business_info:location", () =>
      readBusinessLocation(linked)
    )
    const current = categoryIds(location)
    const merged = mergeCategories(input, current)
    if (!merged.ok) return { eligible: false, reason: merged.reason, current }
    if (sameCategories(merged.categories, current))
      return { eligible: false, reason: "already_applied", current }
    const regionCode = regionOf(location)
    if (!regionCode)
      return { eligible: false, reason: "category_region_unknown", current }
    const languageCode =
      typeof location.languageCode === "string" ? location.languageCode : "en"
    const names = [
      merged.categories.primary as string,
      ...merged.categories.additional,
    ]
    const found =
      batchSchema.parse(
        await reads.once(
          `categories:batch:${regionCode}:${languageCode}:${[...names].sort().join(",")}`,
          async () =>
            batchGetGoogleCategories(
              await linked.accessToken(),
              { names, languageCode, regionCode },
              { connectionKey: linked.connectionId }
            )
        )
      ).categories ?? []
    const known = new Set(found.map((category) => category.name))
    if (names.some((name) => !known.has(name)))
      return { eligible: false, reason: "category_not_available", current }
    const proposal: ProposedCategories = {
      primary: merged.categories.primary as string,
      additional: merged.categories.additional,
      moreHoursTypes: [
        ...new Set(
          found.flatMap((category) =>
            (category.moreHoursTypes ?? []).map((type) => type.hoursTypeId)
          )
        ),
      ].sort(),
      regionCode,
      languageCode,
    }
    reads.propose("categories", proposal)
    return {
      eligible: true,
      current,
      proposed: merged.categories,
      updateMask: ["categories"],
    }
  },
  async dispatch(context) {
    const { linked } = context
    const target = context.proposed as CategoryIds
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
    const current = categoryIds(observed)
    if (sameCategories(current, target))
      return { kind: "succeeded", confirmation: "confirmed", observed: current }
    if (comparisonHash(current) !== comparisonHash(context.current))
      return {
        kind: "conflict",
        code: "google_baseline_changed",
        observed: current,
      }
    if (!context.stillOpen()) return { kind: "expired" }
    const send = async (validateOnly: boolean) =>
      patchGoogleLocation(
        await linked.accessToken(),
        {
          locationName: linked.googleLocationName,
          updateMask: ["categories"],
          validateOnly,
          payload: categoriesPayload(target),
        },
        { connectionKey: linked.connectionId }
      )
    return runBulkWrite(context, {
      family: "categories",
      surface: "business_info",
      action: "update_categories",
      writeSurface: "profileWrites",
      intended: { categories: target },
      validate: () => send(true),
      mutate: () => send(false),
      read: () => readBusinessLocation(linked),
      verify: (readback) => sameCategories(categoryIds(readback), target),
    })
  },
  reconcile: reconcileFromReceipt,
}
