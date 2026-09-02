import { z } from "zod"

import {
  publishFoodMenusSchema,
  saveFoodMenusSchema,
  type FoodMenusResponse,
  type PublishFoodMenusResult,
  type SaveFoodMenusResult,
} from "@/lib/contracts/location-food-menus"
import {
  getFoodMenusState,
  publishFoodMenus,
  saveCanonicalFoodMenus,
} from "@/lib/server/food-menus"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
      foodMenus: await getFoodMenusState(session, params.id),
    }) satisfies FoodMenusResponse,
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveFoodMenusSchema,
  handler: ({ session, params, body, requestId }): Promise<SaveFoodMenusResult> =>
    saveCanonicalFoodMenus({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      menus: body.menus,
      requestId,
    }),
})

export const POST = route({
  params: paramsSchema,
  body: publishFoodMenusSchema,
  handler: ({ session, params, body, requestId }): Promise<PublishFoodMenusResult> =>
    publishFoodMenus({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      expectedCanonicalHash: body.expectedCanonicalHash,
      expectedGoogleHash: body.expectedGoogleHash,
      confirmFullReplacement: body.confirmFullReplacement,
      requestId,
    }),
})
