import { z } from "zod"

import {
  getFoodMenusState,
  publishFoodMenus,
  saveCanonicalFoodMenus,
} from "@/lib/server/food-menus"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.uuid() })

const saveSchema = z.object({
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  menus: z.array(z.record(z.string(), z.unknown())).max(100),
})

const publishSchema = z.object({
  confirmation: z.literal("publish_nabapresence_food_menus_to_google"),
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  expectedCanonicalHash: z.string().length(64),
  expectedGoogleHash: z.string().length(64),
  confirmFullReplacement: z.literal(true),
})

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) => ({
    foodMenus: await getFoodMenusState(session, params.id),
  }),
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveSchema,
  handler: ({ session, params, body, requestId }) =>
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
  body: publishSchema,
  handler: ({ session, params, body, requestId }) =>
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
