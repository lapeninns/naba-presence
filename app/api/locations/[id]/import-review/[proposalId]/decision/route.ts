import { z } from "zod"

import {
  importConfirmationFor,
  importReviewDecisionRequestSchema,
  type ImportReviewDecisionResponse,
} from "@/lib/contracts/location-import-review"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  decideImportProposal,
  listImportProposals,
} from "@/lib/server/import-review"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  roles: ["owner", "admin"],
  params: z.object({ id: z.uuid(), proposalId: z.string() }),
  body: importReviewDecisionRequestSchema,
  handler: async ({ session, params, body, requestId }) => {
    // The kill switch beats the proposal lookup so a paused feature reads as
    // paused, not as a missing suggestion.
    if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
      throw new ApiError(503, "import_review_paused", "Google import review is paused.")
    }
    const locationId = params.id

    // The confirmation literal must match the proposal's surface, mirroring
    // the direction cross-check on the profile operation route.
    const { proposals } = await listImportProposals({
      session,
      locationId,
      includeDecided: true,
    })
    const proposal = proposals.find(
      (row) => row.id === z.uuid().parse(params.proposalId)
    )
    if (!proposal) {
      throw new ApiError(404, "proposal_not_found", "This suggestion no longer exists.")
    }
    if (body.confirmation !== importConfirmationFor(proposal.resourceType)) {
      throw new ApiError(
        400,
        "import_confirmation_invalid",
        "The import confirmation does not match this suggestion."
      )
    }

    const decided = await decideImportProposal({
      session,
      locationId,
      proposalId: proposal.id,
      action: body.action,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      confirmOverwriteCanonicalChanges: body.confirmOverwriteCanonicalChanges,
      requestId,
    })
    return decided satisfies ImportReviewDecisionResponse
  },
})
