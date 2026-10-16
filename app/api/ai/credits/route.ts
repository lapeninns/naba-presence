import { getAiCredits } from "@/lib/server/ai-credits"
import { getServerEnv } from "@/lib/server/env"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The month's AI draft credits. Any member can read it. `aiConfigured` says
 * whether this deployment has an AI provider at all (the draft route answers
 * 503 `ai_not_configured` without it), so the composer can say so before a
 * failed attempt. It reads the environment, not the database: no schema.
 */
export const GET = route({
  handler: async ({ session, tenant }) => {
    const credits = await tenant((sql) =>
      getAiCredits(sql, session.organisationId)
    )
    return { ...credits, aiConfigured: Boolean(getServerEnv().OPENAI_API_KEY) }
  },
})
