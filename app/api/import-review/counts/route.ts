import { pendingProposalCounts } from "@/lib/server/import-review"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session }) => ({
    counts: await pendingProposalCounts({ session }),
  }),
})
