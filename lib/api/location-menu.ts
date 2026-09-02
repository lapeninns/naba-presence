import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export type FoodMenu = Record<string, unknown>

const countsSchema = z.object({ menus: z.number(), sections: z.number(), items: z.number(), options: z.number() })

const foodMenusStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  eligible: z.boolean(),
  status: z.enum(["in_sync", "drift"]),
  canonicalMenus: z.array(z.record(z.string(), z.unknown())),
  googleMenus: z.array(z.record(z.string(), z.unknown())),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canonicalCounts: countsSchema,
  googleCounts: countsSchema,
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
})
export type FoodMenusState = z.infer<typeof foodMenusStateSchema>

export function fetchFoodMenus(id: string, options?: RequestOptions): Promise<FoodMenusState> {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    schema: z.object({ foodMenus: foodMenusStateSchema }),
    ...options,
  }).then((r) => r.foodMenus)
}

export function saveFoodMenus(id: string, input: { expectedCanonicalRevision: string; menus: FoodMenu[] }) {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type PublishMenusInput = { expectedCanonicalRevision: string; expectedCanonicalHash: string; expectedGoogleHash: string }

export function publishFoodMenus(id: string, input: PublishMenusInput) {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "POST",
    body: { confirmation: "publish_nabapresence_food_menus_to_google", ...input, confirmFullReplacement: true },
    schema: z.object({ status: z.string(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
