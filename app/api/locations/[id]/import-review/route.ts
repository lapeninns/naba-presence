import { NextResponse } from "next/server"
import { z } from "zod"

import { PROPOSAL_RESOURCE_TYPES } from "@/lib/domain/import-review"
import { getServerEnv } from "@/lib/server/env"
import { apiError } from "@/lib/server/http"
import { listImportProposals } from "@/lib/server/import-review"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  resourceType: z.enum(PROPOSAL_RESOURCE_TYPES).optional(),
  status: z.enum(["pending", "decided"]).default("pending"),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    const url = new URL(request.url)
    const query = querySchema.parse({
      resourceType: url.searchParams.get("resourceType") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    })
    const result = await listImportProposals({
      session,
      locationId: z.uuid().parse(id),
      resourceType: query.resourceType,
      includeDecided: query.status === "decided",
    })
    return NextResponse.json({
      ...result,
      importReviewEnabled: getServerEnv().IMPORT_REVIEW_ENABLED,
    })
  } catch (error) {
    return apiError(error)
  }
}
