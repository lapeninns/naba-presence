import { expect, it } from "vitest"

import { generateReply, semanticVerification } from "@/lib/server/ai"
import { getServerEnv } from "@/lib/server/env"

// Opt-in: uses real OpenAI inference with synthetic evidence only. Never
// publishes, sends messages, or connects to a database.
it.skipIf(process.env.RUN_LIVE_AI_TESTS !== "true")(
  "generates and semantically verifies with the configured live OpenAI models",
  async () => {
    const evidence = {
      reviewText: "The pie was delicious and the staff were friendly.",
      rating: 5,
      reviewerName: "Alex",
      locationName: "Example Inn",
      language: "en",
      tone: "warm_professional" as const,
    }
    const draft = await generateReply(evidence)
    expect(draft.reply.length).toBeGreaterThan(0)
    expect(draft.language).toBe("en")
    expect(draft.model).toBe(getServerEnv().OPENAI_MODEL_DRAFT)
    expect(draft.usage.inputTokens).toBeGreaterThan(0)
    expect(draft.usage.outputTokens).toBeGreaterThan(0)
    const verified = await semanticVerification({
      ...evidence,
      body: draft.reply,
      expectedLanguage: "en",
    })
    expect(verified.ran).toBe(true)
    expect(verified.model).toBe(getServerEnv().OPENAI_MODEL_VERIFY)
    expect(verified.usage?.inputTokens).toBeGreaterThan(0)
    expect(verified.usage?.outputTokens).toBeGreaterThan(0)
    expect(Array.isArray(verified.reasons)).toBe(true)
  },
  65_000
)
