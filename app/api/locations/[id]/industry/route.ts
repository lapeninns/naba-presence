import { NextResponse } from "next/server"
import { z } from "zod"

import { loadIndustryManagement, mutateIndustryManagement } from "@/lib/server/industry-management"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const OPERATIONS = ["update_lodging", "update_business_calls", "update_healthcare_services", "update_healthcare_provider_attributes"] as const

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    return NextResponse.json({ industry: await loadIndustryManagement(session, z.uuid().parse(id)) })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const input = z.object({
      operation: z.enum(OPERATIONS),
      confirmation: z.literal("publish_industry_data_to_google"),
      updateMask: z.array(z.string().trim().min(1)).min(1),
      payload: z.record(z.string(), z.unknown()),
    }).parse(await request.json())
    if (input.operation === "update_business_calls" && input.updateMask.some((field) => field !== "callsState")) throw new ApiError(422, "business_calls_mask_invalid", "Only callsState can be updated for Business Calls.")
    return NextResponse.json(await mutateIndustryManagement({ session, locationId: z.uuid().parse(id), operation: input.operation, payload: input.payload, updateMask: input.updateMask, requestId: rid.id }))
  } catch (error) { return apiError(error) }
}
