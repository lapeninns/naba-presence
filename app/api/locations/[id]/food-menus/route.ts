import { NextResponse } from "next/server"
import { z } from "zod"

import {
  getFoodMenusState,
  publishFoodMenus,
  saveCanonicalFoodMenus,
} from "@/lib/server/food-menus"
import { apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({
      foodMenus: await getFoodMenusState(session, z.uuid().parse(id)),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const input = saveSchema.parse(await request.json())
    return NextResponse.json(
      await saveCanonicalFoodMenus({
        session,
        locationId: z.uuid().parse(id),
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        menus: input.menus,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id } = await params
    const input = publishSchema.parse(await request.json())
    return NextResponse.json(
      await publishFoodMenus({
        session,
        locationId: z.uuid().parse(id),
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        expectedCanonicalHash: input.expectedCanonicalHash,
        expectedGoogleHash: input.expectedGoogleHash,
        confirmFullReplacement: input.confirmFullReplacement,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
