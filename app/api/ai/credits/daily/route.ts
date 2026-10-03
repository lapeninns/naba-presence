import { getAiCreditsDaily } from "@/lib/server/ai-credits"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** Credits spent per day this month. Any member can read it. */
export const GET = route({
  handler: async ({ session, tenant }) =>
    tenant((sql) => getAiCreditsDaily(sql, session.organisationId)),
})
