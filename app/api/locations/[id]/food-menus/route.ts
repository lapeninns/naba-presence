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
  saveCanonicalFoodMenus,
} from "@/lib/server/food-menus"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { invalidatePendingListingChanges } from "@/lib/server/listing-changes"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The publish POST does a live Google read, the menu PATCH and a read-back;
// the platform default would cut it off mid-write.
export const maxDuration = 60

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
  handler: async ({
    session,
    params,
    body,
    requestId,
  }): Promise<SaveFoodMenusResult> => {
    const saved = await saveCanonicalFoodMenus({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      menus: body.menus,
      requestId,
    })
    // A publish waiting for approval was for the menus before this save.
    await invalidatePendingListingChanges({
      organisationId: session.organisationId,
      locationId: params.id,
      kinds: ["food_menus_publish"],
    })
    return saved
  },
})

export const POST = route({
  mfa: "step_up",
  params: paramsSchema,
  body: publishFoodMenusSchema,
  handler: ({
    session,
    params,
    body,
    requestId,
  }): Promise<PublishFoodMenusResult | Response> =>
    // Parks for a second publisher in two-person mode
    // (lib/server/listing-change-registry.ts); sent as before otherwise.
    submitListingChange("food_menus_publish", {
      session,
      locationId: params.id,
      body,
      requestId,
    }),
})
