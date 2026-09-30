import { createServer, type Server } from "node:http"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const StubMode = {
  retryOnce: "retry_once",
  unavailable: "unavailable",
} as const

type StubMode = (typeof StubMode)[keyof typeof StubMode]

describe("Google transport", () => {
  let calls: number
  let mode: StubMode
  let server: Server
  let stubBaseUrl: string

  beforeEach(async () => {
    vi.resetModules()
    calls = 0
    mode = StubMode.retryOnce
    process.env.DATABASE_URL = "postgresql://runtime@example.test/naba"
    process.env.NEXTAUTH_SECRET = "n".repeat(32)
    process.env.TOKEN_ENCRYPTION_KEY = "t".repeat(32)
    process.env.CRON_SECRET = "c".repeat(16)
    process.env.GOOGLE_REQUESTS_PER_SECOND = "100"
    process.env.GOOGLE_TIMEOUT_MS = "1000"
    process.env.GOOGLE_MUTATION_TIMEOUT_MS = "1000"

    server = createServer((_request, response) => {
      calls += 1
      if (mode === StubMode.retryOnce && calls > 1) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true }))
        return
      }
      response.writeHead(503, {
        "content-type": "application/json",
        "retry-after": "0.001",
      })
      response.end(
        JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Provider unavailable" },
        })
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") {
      throw new TypeError("The Google transport stub did not bind a TCP port.")
    }
    stubBaseUrl = `http://127.0.0.1:${address.port}`
    process.env.GOOGLE_API_PROXY_BASE = stubBaseUrl
  })

  afterEach(async () => {
    delete process.env.GOOGLE_API_PROXY_BASE
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    vi.restoreAllMocks()
  })

  it.each([
    "https://mybusiness.googleapis.com/v4/example",
    "https://businessprofileperformance.googleapis.com/v1/locations/1:fetchMultiDailyMetricsTimeSeries",
  ])("retries a supported safe request %s when Google is temporarily unavailable", async (url) => {
    // Given: a provider that succeeds after one retryable response.
    const { googleRequest } = await import("@/lib/server/google")

    // When: a safe request crosses the real HTTP transport.
    const result = await googleRequest<{ readonly ok: boolean }>(
      url,
      "access-token",
      {},
      { maxAttempts: 2, timeoutMs: 1000 }
    )

    // Then: the successful response is returned after exactly one retry.
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  it("does not replay an ambiguous mutation", async () => {
    // Given: a provider that returns an ambiguous server failure.
    mode = StubMode.unavailable
    const { GoogleMutationAmbiguousError, googleRequest } = await import(
      "@/lib/server/google"
    )

    // When: a mutation crosses the real HTTP transport.
    const request = googleRequest(
      "https://mybusiness.googleapis.com/v4/example",
      "access-token",
      { method: "POST", body: JSON.stringify({ reply: "Thanks" }) },
      { mode: "mutation", timeoutMs: 1000 }
    )

    // Then: ambiguity is surfaced without a second provider write.
    await expect(request).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
    expect(calls).toBe(1)
  })

  it.each([
    "https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallssettings",
    "https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallsinsights",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/healthProviderAttributes",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/insuranceNetworks",
    "https://mybusinessqanda.googleapis.com/v1/locations/1/questions",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions/3/answers",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations:reportInsights",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts:reportInsights",
    "https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:associate",
    "https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:clearLocationAssociation",
  ])("rejects retired resource %s before any provider request", async (url) => {
    // Given: an old caller still constructing a retired resource URL.
    const { googleRequest } = await import("@/lib/server/google")

    // When: the request enters the shared transport, including its test proxy.
    const request = googleRequest(url, "access-token", {}, { maxAttempts: 1 })

    // Then: it returns a stable unsupported outcome without network activity.
    await expect(request).rejects.toMatchObject({
      status: 410,
      code: "provider_capability_retired",
    })
    expect(calls).toBe(0)
  })
})
