import {
  FOOD_MENUS_PUBLISH_CONFIRMATION,
  foodMenusResponseSchema,
  publishFoodMenusResultSchema,
  saveFoodMenusResultSchema,
  type FoodMenusState,
  type PublishFoodMenusBody,
  type PublishFoodMenusInput,
  type SaveFoodMenusBody,
} from "@/lib/contracts/location-food-menus"

import { apiFetch, type RequestOptions } from "./client"

export type { FoodMenu, FoodMenusState, PublishFoodMenusInput as PublishMenusInput } from "@/lib/contracts/location-food-menus"

export function fetchFoodMenus(id: string, options?: RequestOptions): Promise<FoodMenusState> {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    schema: foodMenusResponseSchema,
    ...options,
  }).then((r) => r.foodMenus)
}

export function saveFoodMenus(id: string, input: SaveFoodMenusBody) {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "PUT",
    body: input,
    schema: saveFoodMenusResultSchema,
  })
}

export function publishFoodMenus(id: string, input: PublishFoodMenusInput) {
  const body: PublishFoodMenusBody = { confirmation: FOOD_MENUS_PUBLISH_CONFIRMATION, ...input, confirmFullReplacement: true }
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "POST",
    body,
    schema: publishFoodMenusResultSchema,
  })
}
