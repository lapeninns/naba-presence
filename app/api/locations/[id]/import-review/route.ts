import { z } from "zod"

import { PROPOSAL_RESOURCE_TYPES } from "@/lib/domain/import-review"
import { getServerEnv } from "@/lib/server/env"
import { listImportProposals } from "@/lib/server/import-review"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const querySchema = z.object({
  resourceType: z.enum(PROPOSAL_RESOURCE_TYPES).optional(),
  status: z.enum(["pending", "decided"]).default("pending"),
})

export const GET = route({
  params: z.object({ id: z.uuid() }),
  query: querySchema,
  handler: async ({ session, params, query }) => {
    const result = await listImportProposals({
      session,
      locationId: params.id,
      resourceType: query.resourceType,
      includeDecided: query.status === "decided",
    })
    return {
      ...result,
      importReviewEnabled: getServerEnv().IMPORT_REVIEW_ENABLED,
    }
  },
})
