import { NextResponse } from "next/server"
import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { readLiveFoodMenus } from "@/lib/server/food-menus"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  raiseFoodMenuProposals,
  raiseProfileProposals,
  type RaiseOutcome,
} from "@/lib/server/import-review"
import { readProfileStateBundle } from "@/lib/server/profile"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  resourceType: z.enum(["profile", "food_menus", "all"]).default("all"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
      throw new ApiError(503, "import_review_paused", "Google import review is paused.")
    }
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const input = inputSchema.parse(
      await request.json().catch(() => ({}))
    )
    const outcomes: Partial<Record<"profile" | "foodMenus", RaiseOutcome>> = {}
    if (input.resourceType === "food_menus" || input.resourceType === "all") {
      const live = await readLiveFoodMenus(session, locationId)
      outcomes.foodMenus = await raiseFoodMenuProposals({
        session,
        locationId,
        live,
        via: "manual",
        requestId: rid.id,
      })
    }
    if (input.resourceType === "profile" || input.resourceType === "all") {
      const bundle = await readProfileStateBundle(session, locationId)
      outcomes.profile = await raiseProfileProposals({
        session,
        locationId,
        bundle,
        via: "manual",
        requestId: rid.id,
      })
    }
    return NextResponse.json({ refreshed: true as const, outcomes })
  } catch (error) {
    return apiError(error)
  }
}
