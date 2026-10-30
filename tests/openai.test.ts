import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateReply, semanticVerification } from "@/lib/server/ai"
import { runSemanticVerification } from "@/lib/server/drafts"

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
  OPENAI_API_KEY: "test-openai-key",
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

function completion(value: unknown, status = "completed") {
  return Response.json({
    status,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
    usage: { input_tokens: 120, output_tokens: 33 },
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

describe("OpenAI review integration", () => {
  it("sends structured Responses requests with the existing OpenAI credentials", async () => {
    settings.values = { ...baseEnv, OPENAI_ORG_ID: "org-test" }
    fetchMock.mockResolvedValue(completion(draft))
    expect(await generateReply(draftInput)).toEqual({
      ...draft,
      usage: { inputTokens: 120, outputTokens: 33 },
      model: "gpt-5.6-luna",
    })
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) throw new Error("Expected a provider call")
    const [url, options] = call
    expect(String(url)).toBe("https://api.openai.com/v1/responses")
    expect(options?.headers).toEqual({
      authorization: "Bearer test-openai-key",
      "content-type": "application/json",
      "OpenAI-Organization": "org-test",
    })
    expect(options?.cache).toBe("no-store")
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(options?.body))
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      stream: false,
      max_output_tokens: 4096,
      text: {
        format: {
          type: "json_schema",
          name: "google_review_reply",
          strict: true,
          schema: { required: ["reply", "language"] },
        },
      },
    })
    expect(body.reasoning).toBeUndefined()
    expect(body.input).toContain("The pie was lovely.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["gpt-4.1-nano", "gpt-4.1-nano-2025-04-14"])(
    "uses and reports the supported replacement for configured %s",
    async (model) => {
      settings.values = {
        ...baseEnv,
        OPENAI_MODEL_DRAFT: model,
        OPENAI_MODEL_VERIFY: model,
      }
      fetchMock
        .mockResolvedValueOnce(completion(draft))
        .mockResolvedValueOnce(completion(verdict))

      expect((await generateReply(draftInput)).model).toBe("gpt-5.6-luna")
      expect((await semanticVerification(verificationInput)).model).toBe(
        "gpt-5.6-luna"
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const [, options] of fetchMock.mock.calls) {
        expect(JSON.parse(String(options?.body)).model).toBe("gpt-5.6-luna")
      }
    }
  )

  it("uses the same model for semantic verification and preserves verdict reasons", async () => {
    settings.values = { ...baseEnv, OPENAI_MODEL_VERIFY: "gpt-4.1-mini" }
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
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("gpt-4.1-mini")
  })

  it("keeps a successful semantic result distinguishable from a skipped check", async () => {
    fetchMock.mockResolvedValue(completion(verdict))
    expect(await semanticVerification(verificationInput)).toEqual({
      ran: true,
      reasons: [],
      usage: { inputTokens: 120, outputTokens: 33 },
      model: "gpt-5.6-luna",
    })
    settings.values = { ...baseEnv, SEMANTIC_VERIFY_ENABLED: "false" }
    expect(await semanticVerification(verificationInput)).toEqual({
      ran: false,
      reasons: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["OPENAI_API_KEY"])(
    "does not call a provider when %s is absent",
    async (key) => {
      settings.values = {
        ...baseEnv,
        [key]: "",
        WORKERS_AI_API_TOKEN: "must-never-be-used",
        WORKERS_AI_ACCOUNT_ID: "a".repeat(32),
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
        message: "OpenAI rejected the request.",
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    [
      "malformed envelope",
      () => Response.json({ output: [] }),
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
      () => completion(draft, "incomplete"),
      "ai_incomplete_response",
    ],
    [
      "empty output",
      () =>
        Response.json({
          status: "completed",
          output: [],
        }),
      "ai_empty_response",
    ],
    [
      "invalid content JSON",
      () =>
        Response.json({
          status: "completed",
          output_text: "```json",
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

  it("retains billed usage on an incomplete response", async () => {
    fetchMock.mockResolvedValue(completion(draft, "incomplete"))
    await expect(generateReply(draftInput)).rejects.toMatchObject({
      code: "ai_incomplete_response",
      model: "gpt-5.6-luna",
      usage: { inputTokens: 120, outputTokens: 33 },
    })
  })

  it("does not accept a refusal as generated content", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Refused" }],
          },
        ],
        usage: { input_tokens: 120, output_tokens: 33 },
      })
    )
    await expect(generateReply(draftInput)).rejects.toMatchObject({
      code: "ai_empty_response",
      usage: { inputTokens: 120, outputTokens: 33 },
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
