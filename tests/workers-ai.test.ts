import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateReply, semanticVerification } from "@/lib/server/ai"
import { runSemanticVerification } from "@/lib/server/drafts"
import { serverEnvSchema } from "@/lib/server/env"

const { settings } = vi.hoisted(() => ({ settings: { values: {} } }))
vi.mock("@/lib/server/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/server/env")>()
  return {
    ...original,
    getServerEnv: () => original.serverEnvSchema.parse(settings.values),
  }
})

const baseEnv = {
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
  WORKERS_AI_API_TOKEN: "test-workers-ai-token",
  WORKERS_AI_ACCOUNT_ID: "a".repeat(32),
}
const draftInput = {
  reviewText: "The pie was lovely.",
  rating: 5,
  reviewerName: "Alex",
  locationName: "Example Inn",
  language: "en",
  tone: "warm_professional",
} as const
const verificationInput = {
  body: "Thank you for your review.",
  reviewText: "The pie was lovely.",
  locationName: "Example Inn",
  rating: 5,
  expectedLanguage: "en",
}
const draft = { reply: "Thank you for your review.", language: "en" }
const verdict = {
  unsupportedClaims: [],
  unsafeEscalation: false,
  toneMismatch: false,
}
const fetchMock = vi.fn<typeof fetch>()

function completion(value: unknown, finishReason = "stop") {
  return Response.json({
    choices: [
      {
        finish_reason: finishReason,
        message: { content: JSON.stringify(value) },
      },
    ],
  })
}

beforeEach(() => {
  settings.values = { ...baseEnv }
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe("Workers AI review integration", () => {
  it("sends structured GLM requests directly to the account with no gateway or OpenAI credentials", async () => {
    settings.values = { ...baseEnv, OPENAI_API_KEY: "must-never-be-used" }
    fetchMock.mockResolvedValue(completion(draft))
    expect(await generateReply(draftInput)).toEqual(draft)
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) throw new Error("Expected a provider call")
    const [url, options] = call
    expect(String(url)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${baseEnv.WORKERS_AI_ACCOUNT_ID}/ai/v1/chat/completions`
    )
    expect(options?.headers).toEqual({
      authorization: "Bearer test-workers-ai-token",
      "content-type": "application/json",
    })
    expect(options?.cache).toBe("no-store")
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(options?.body))
    expect(body).toMatchObject({
      model: "@cf/zai-org/glm-5.3-flash",
      store: false,
      stream: false,
      reasoning_effort: "low",
      max_completion_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "google_review_reply",
          strict: true,
          schema: { required: ["reply", "language"] },
        },
      },
    })
    expect(body.messages[0].content).toContain("The pie was lovely.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("uses the same model for semantic verification and preserves verdict reasons", async () => {
    fetchMock.mockResolvedValue(
      completion({
        unsupportedClaims: ["Invented refund"],
        unsafeEscalation: true,
        toneMismatch: true,
      })
    )
    const result = await semanticVerification(verificationInput)
    expect(result.ran).toBe(true)
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "unsupported_claim",
      "unsafe_escalation",
      "tone_mismatch",
    ])
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      '"name":"review_reply_verification"'
    )
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      serverEnvSchema.parse(baseEnv).WORKERS_AI_MODEL
    )
  })

  it("keeps a successful semantic result distinguishable from a skipped check", async () => {
    fetchMock.mockResolvedValue(completion(verdict))
    expect(await semanticVerification(verificationInput)).toEqual({
      ran: true,
      reasons: [],
    })
    settings.values = { ...baseEnv, SEMANTIC_VERIFY_ENABLED: "false" }
    expect(await semanticVerification(verificationInput)).toEqual({
      ran: false,
      reasons: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["WORKERS_AI_API_TOKEN", "WORKERS_AI_ACCOUNT_ID"])(
    "does not call a provider when %s is absent",
    async (key) => {
      settings.values = {
        ...baseEnv,
        [key]: "",
        OPENAI_API_KEY: "must-never-be-used",
      }
      await expect(generateReply(draftInput)).rejects.toMatchObject({
        status: 503,
        code: "ai_not_configured",
      })
      expect(await semanticVerification(verificationInput)).toEqual({
        ran: false,
        reasons: [],
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([401, 403, 429, 500, 503])(
    "handles HTTP %s without leaking provider details or falling back",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response("private provider diagnostic", { status })
      )
      await expect(generateReply(draftInput)).rejects.toMatchObject({
        status: status === 429 ? 429 : 502,
        code: "ai_provider_error",
        message: "Cloudflare Workers AI rejected the request.",
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    [
      "malformed envelope",
      () => Response.json({ choices: [] }),
      "ai_invalid_response",
    ],
    [
      "malformed HTTP JSON",
      () => new Response("not json"),
      "ai_invalid_response",
    ],
    [
      "invalid structured output",
      () => completion({ reply: "" }),
      "ai_invalid_response",
    ],
    [
      "truncated output",
      () => completion(draft, "length"),
      "ai_incomplete_response",
    ],
    [
      "empty output",
      () =>
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: null } }],
        }),
      "ai_empty_response",
    ],
    [
      "invalid content JSON",
      () =>
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: "```json" } }],
        }),
      "ai_invalid_response",
    ],
  ] as const)("rejects %s", async (_name, makeResponse, code) => {
    fetchMock.mockResolvedValue(makeResponse())
    await expect(generateReply(draftInput)).rejects.toMatchObject({
      status: 502,
      code,
    })
  })

  it("keeps drafts pending when semantic verification receives malformed output", async () => {
    fetchMock.mockResolvedValue(completion({ unsupportedClaims: "invalid" }))
    expect(await runSemanticVerification(verificationInput)).toMatchObject({
      status: "unavailable",
      reasons: [{ code: "semantic_verification_unavailable" }],
    })
  })

  it.each(["TimeoutError", "AbortError"])("normalizes %s", async (name) => {
    fetchMock.mockRejectedValue(new DOMException("provider timeout", name))
    await expect(generateReply(draftInput)).rejects.toMatchObject({
      status: 502,
      code: "ai_timeout",
    })
  })

  it("normalizes transport failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(generateReply(draftInput)).rejects.toMatchObject({
      status: 502,
      code: "ai_provider_error",
    })
  })
})
