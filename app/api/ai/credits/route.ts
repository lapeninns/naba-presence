import { getAiCredits } from "@/lib/server/ai-credits"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The month's AI draft credits. Any member can read it. */
export const GET = route({
  handler: async ({ session, tenant }) =>
    tenant((sql) => getAiCredits(sql, session.organisationId)),
})
