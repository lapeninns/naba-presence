import type { ImportReviewCountsResponse } from "@/lib/contracts/location-import-review"
import { pendingProposalCounts } from "@/lib/server/import-review"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session }) =>
    ({
      counts: await pendingProposalCounts({ session }),
    }) satisfies ImportReviewCountsResponse,
})
