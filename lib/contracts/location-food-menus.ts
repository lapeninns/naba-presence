// Contract for /api/locations/[id]/food-menus. Client-safe: zod plus the
// client-safe vocabulary from lib/domain (lib/domain/food-menus.ts hashes with
// node:crypto and must not be imported here; see lib/domain/README.md).
import { z } from "zod"

import {
  FOOD_MENUS_SYNC_STATUSES,
  type FoodMenuCounts,
} from "@/lib/domain/food-menus-vocabulary"

export {
  FOOD_MENUS_SYNC_STATUSES,
  type FoodMenuCounts,
  type FoodMenusSyncStatus,
} from "@/lib/domain/food-menus-vocabulary"

// --- menu hierarchy ---------------------------------------------------------
// Google FoodMenu resources are passthrough records: the editor reads known
// leaves and preserves everything else. Only the nesting is described here.

export const foodMenuOptionSchema = z.record(z.string(), z.unknown())
export type FoodMenuOption = z.infer<typeof foodMenuOptionSchema>

export const foodMenuItemSchema = z.looseObject({
  options: z.array(foodMenuOptionSchema).optional(),
})
export type FoodMenuItem = z.infer<typeof foodMenuItemSchema>

export const foodMenuSectionSchema = z.looseObject({
  items: z.array(foodMenuItemSchema).optional(),
})
export type FoodMenuSection = z.infer<typeof foodMenuSectionSchema>

/** One Google FoodMenu as sent over the wire (freeform; see above). */
export const foodMenuSchema = z.record(z.string(), z.unknown())
export type FoodMenu = z.infer<typeof foodMenuSchema>

export const foodMenuCountsSchema = z.object({
  menus: z.number(),
  sections: z.number(),
  items: z.number(),
  options: z.number(),
}) satisfies z.ZodType<FoodMenuCounts>

// --- GET ------------------------------------------------------------------

export const foodMenusStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  eligible: z.boolean(),
  status: z.enum(FOOD_MENUS_SYNC_STATUSES),
  canonicalMenus: z.array(foodMenuSchema),
  googleMenus: z.array(foodMenuSchema),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canonicalCounts: foodMenuCountsSchema,
  googleCounts: foodMenuCountsSchema,
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
})
export type FoodMenusState = z.infer<typeof foodMenusStateSchema>

export const foodMenusResponseSchema = z.object({ foodMenus: foodMenusStateSchema })
export type FoodMenusResponse = z.infer<typeof foodMenusResponseSchema>

// --- PUT (save canonical) -----------------------------------------------------

const canonicalRevision = z.string().regex(/^\d+$/)

export const saveFoodMenusSchema = z.object({
  expectedCanonicalRevision: canonicalRevision,
  menus: z.array(foodMenuSchema).max(100),
})
export type SaveFoodMenusBody = z.infer<typeof saveFoodMenusSchema>

export const saveFoodMenusResultSchema = z.object({
  saved: z.literal(true),
  revision: z.string(),
})
export type SaveFoodMenusResult = z.infer<typeof saveFoodMenusResultSchema>

// --- POST (publish) ---------------------------------------------------------

export const FOOD_MENUS_PUBLISH_CONFIRMATION = "publish_nabapresence_food_menus_to_google" as const

export const publishFoodMenusSchema = z.object({
  confirmation: z.literal(FOOD_MENUS_PUBLISH_CONFIRMATION),
  expectedCanonicalRevision: canonicalRevision,
  expectedCanonicalHash: z.string().length(64),
  expectedGoogleHash: z.string().length(64),
  confirmFullReplacement: z.literal(true),
})
export type PublishFoodMenusBody = z.infer<typeof publishFoodMenusSchema>

/** What the client supplies; the confirmation literals are added by the client module. */
export type PublishFoodMenusInput = Pick<
  PublishFoodMenusBody,
  "expectedCanonicalRevision" | "expectedCanonicalHash" | "expectedGoogleHash"
>

export const publishFoodMenusResultSchema = z.object({
  status: z.string(),
  attemptId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type PublishFoodMenusResult = z.infer<typeof publishFoodMenusResultSchema>
