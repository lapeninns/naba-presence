import "server-only"

import type { BulkOperation } from "@/lib/domain/bulk-merge"
import { attributesFamily } from "@/lib/server/bulk-families/attributes"
import { businessInfoFamily } from "@/lib/server/bulk-families/business-info"
import { categoriesFamily } from "@/lib/server/bulk-families/categories"
import { foodMenusFamily } from "@/lib/server/bulk-families/food-menus"
import { hoursFamily } from "@/lib/server/bulk-families/hours"
import { lodgingFamily } from "@/lib/server/bulk-families/industry"
import { photosFamily } from "@/lib/server/bulk-families/photos"
import { placeActionsFamily } from "@/lib/server/bulk-families/place-actions"
import { postDraftsFamily } from "@/lib/server/bulk-families/posts"
import type { BulkFamily } from "@/lib/server/bulk-families/types"

/**
 * Every bulk family, by the operation it serves. Each plans a listing
 * (read only), dispatches a claimed child through its surface's write
 * pipeline with a receipt, and reconciles an unresolved child from that
 * receipt (lib/server/bulk-listing-runner.ts).
 */
const FAMILIES: Record<BulkOperation, BulkFamily> = {
  regular_hours: hoursFamily as BulkFamily,
  special_hours: hoursFamily as BulkFamily,
  more_hours: hoursFamily as BulkFamily,
  attributes: attributesFamily as BulkFamily,
  place_action: placeActionsFamily as BulkFamily,
  business_info: businessInfoFamily as BulkFamily,
  categories: categoriesFamily as BulkFamily,
  lodging: lodgingFamily as BulkFamily,
  food_menus: foodMenusFamily as BulkFamily,
  post_draft: postDraftsFamily as BulkFamily,
  photos: photosFamily as BulkFamily,
}

export function bulkFamily(operation: BulkOperation): BulkFamily {
  return FAMILIES[operation]
}

export type {
  BulkFamily,
  DispatchContext,
  DispatchOutcome,
  PlanReads,
  TargetPlan,
} from "@/lib/server/bulk-families/types"
export {
  bulkApprovalRef,
  bulkIntentId,
  planReads,
  receiptFor,
} from "@/lib/server/bulk-families/shared"
