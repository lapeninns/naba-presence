import { z } from "zod"

import {
  importReviewListQuerySchema,
  type ImportReviewListResponse,
} from "@/lib/contracts/location-import-review"
import { getServerEnv } from "@/lib/server/env"
import { listImportProposals } from "@/lib/server/import-review"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  params: z.object({ id: z.uuid() }),
  query: importReviewListQuerySchema,
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
    } satisfies ImportReviewListResponse
  },
})
