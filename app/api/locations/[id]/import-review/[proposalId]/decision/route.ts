import { NextResponse } from "next/server"
import { z } from "zod"

import { PROPOSAL_DECISION_ACTIONS } from "@/lib/domain/import-review"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  decideImportProposal,
  listImportProposals,
} from "@/lib/server/import-review"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const inputSchema = z.object({
  action: z.enum(PROPOSAL_DECISION_ACTIONS),
  confirmation: z.enum([
    "import_google_profile_to_nabapresence",
    "import_google_food_menus_to_nabapresence",
  ]),
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  confirmOverwriteCanonicalChanges: z.boolean().default(false),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    // The kill switch beats the proposal lookup so a paused feature reads as
    // paused, not as a missing suggestion.
    if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
      throw new ApiError(503, "import_review_paused", "Google import review is paused.")
    }
    const { id, proposalId } = await params
    const locationId = z.uuid().parse(id)
    const input = inputSchema.parse(await request.json())

    // The confirmation literal must match the proposal's surface, mirroring
    // the direction cross-check on the profile operation route.
    const { proposals } = await listImportProposals({
      session,
      locationId,
      includeDecided: true,
    })
    const proposal = proposals.find((row) => row.id === z.uuid().parse(proposalId))
    if (!proposal) {
      throw new ApiError(404, "proposal_not_found", "This suggestion no longer exists.")
    }
    const expectedConfirmation =
      proposal.resourceType === "profile"
        ? "import_google_profile_to_nabapresence"
        : "import_google_food_menus_to_nabapresence"
    if (input.confirmation !== expectedConfirmation) {
      throw new ApiError(
        400,
        "import_confirmation_invalid",
        "The import confirmation does not match this suggestion."
      )
    }

    const result = await decideImportProposal({
      session,
      locationId,
      proposalId: proposal.id,
      action: input.action,
      expectedCanonicalRevision: input.expectedCanonicalRevision,
      confirmOverwriteCanonicalChanges: input.confirmOverwriteCanonicalChanges,
      requestId: rid.id,
    })
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
