import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { readLiveFoodMenus } from "@/lib/server/food-menus"
import { ApiError } from "@/lib/server/http"
import {
  raiseFoodMenuProposals,
  raiseProfileProposals,
  type RaiseOutcome,
} from "@/lib/server/import-review"
import { readProfileStateBundle } from "@/lib/server/profile"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  resourceType: z.enum(["profile", "food_menus", "all"]).default("all"),
})

export const POST = route({
  roles: ["owner", "admin"],
  params: z.object({ id: z.uuid() }),
  body: inputSchema,
  handler: async ({ session, params, body, requestId }) => {
    if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
      throw new ApiError(503, "import_review_paused", "Google import review is paused.")
    }
    const locationId = params.id
    const outcomes: Partial<Record<"profile" | "foodMenus", RaiseOutcome>> = {}
    if (body.resourceType === "food_menus" || body.resourceType === "all") {
      const live = await readLiveFoodMenus(session, locationId)
      outcomes.foodMenus = await raiseFoodMenuProposals({
        session,
        locationId,
        live,
        via: "manual",
        requestId,
      })
    }
    if (body.resourceType === "profile" || body.resourceType === "all") {
      const bundle = await readProfileStateBundle(session, locationId)
      outcomes.profile = await raiseProfileProposals({
        session,
        locationId,
        bundle,
        via: "manual",
        requestId,
      })
    }
    return { refreshed: true as const, outcomes }
  },
})
