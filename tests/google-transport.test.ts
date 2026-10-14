import { createServer, type Server, type ServerResponse } from "node:http"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const StubMode = {
  retryOnce: "retry_once",
  unavailable: "unavailable",
} as const

type StubMode = (typeof StubMode)[keyof typeof StubMode]

describe("Google transport", () => {
  let calls: number
  let mode: StubMode
  // Set by a test to answer every request itself instead of the mode stub.
  let respond: ((response: ServerResponse) => void) | null
  let server: Server
  let stubBaseUrl: string

  beforeEach(async () => {
    vi.resetModules()
    calls = 0
    mode = StubMode.retryOnce
    respond = null
    process.env.DATABASE_URL = "postgresql://runtime@example.test/naba"
    process.env.NEXTAUTH_SECRET = "n".repeat(32)
    process.env.TOKEN_ENCRYPTION_KEY = "t".repeat(32)
    process.env.CRON_SECRET = "c".repeat(16)
    process.env.GOOGLE_REQUESTS_PER_SECOND = "100"
    process.env.GOOGLE_TIMEOUT_MS = "1000"
    process.env.GOOGLE_MUTATION_TIMEOUT_MS = "1000"
    // No database here: the fleet budget would spend each call's deadline
    // waiting for one.
    process.env.GOOGLE_RATE_BUDGET_ENABLED = "false"

    server = createServer((_request, response) => {
      calls += 1
      if (respond) {
        respond(response)
        return
      }
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
    delete process.env.GOOGLE_RATE_BUDGET_ENABLED
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
    ["https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallssettings", "GET"],
    ["https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallssettings?updateMask=callsState", "PATCH"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/healthProviderAttributes?languageCode=en", "GET"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/insuranceNetworks?pageSize=10000", "GET"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions", "GET"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions/3/answers:upsert", "POST"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2:associate", "POST"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2:clearLocationAssociation", "POST"],
    ["https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallsinsights", "GET"],
    ["https://mybusinessqanda.googleapis.com/v1/locations/1/questions", "GET"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations:reportInsights", "POST"],
    ["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts:reportInsights", "POST"],
    ["https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:associate", "POST"],
    ["https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:clearLocationAssociation", "POST"],
  ])("refuses the retired endpoint %s before any network call", async (url, method) => {
    // Given: a provider that would answer anything.
    mode = StubMode.retryOnce
    const { googleRequest } = await import("@/lib/server/google")
    const { ApiError } = await import("@/lib/server/http")

    // When: a request for a switched-off Google API reaches the transport.
    const request = googleRequest(url, "access-token", { method }, {
      mode: method === "GET" ? "safe" : "mutation",
      timeoutMs: 1000,
    })

    // Then: it fails with the stable retired error and nothing was sent.
    await expect(request).rejects.toBeInstanceOf(ApiError)
    await expect(request).rejects.toMatchObject({
      status: 410,
      code: "google_api_retired",
      retryable: false,
    })
    expect(calls).toBe(0)
  })

  it("still sends supported endpoints that sit beside retired ones", async () => {
    // Given: a provider that succeeds after one retryable response.
    const { googleRequest } = await import("@/lib/server/google")

    // When: the still-supported healthcare service list is read.
    const result = await googleRequest<{ readonly ok: boolean }>(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/serviceList",
      "access-token",
      {},
      { maxAttempts: 2, timeoutMs: 1000 }
    )

    // Then: it crosses the transport as before.
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  // Undecodable success: the request was dispatched and Google said 2xx, so
  // a write may have landed whatever the body looks like.
  const undecodableSuccess = {
    "a non-JSON body": (response: ServerResponse) => {
      response.writeHead(200, { "content-type": "text/html" })
      response.end("<html>Service</html>")
    },
    "a truncated JSON body": (response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"name":"locations/1/localPosts/')
    },
    "an empty body": (response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end()
    },
    "a body-read abort": (response: ServerResponse) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": "200",
      })
      response.write('{"name":')
      // Let the headers and the first chunk reach the client, then cut the
      // connection before the declared length.
      setTimeout(() => response.socket?.destroy(), 20)
    },
  } satisfies Record<string, (response: ServerResponse) => void>

  it.each(Object.keys(undecodableSuccess))(
    "settles a mutation answered 2xx with %s as ambiguous",
    async (name) => {
      // Given: a provider that accepts the write but answers badly.
      respond = undecodableSuccess[name as keyof typeof undecodableSuccess]
      const { GoogleMutationAmbiguousError, googleRequest } = await import(
        "@/lib/server/google"
      )

      // When: a mutation crosses the real HTTP transport.
      const request = googleRequest(
        "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts",
        "access-token",
        { method: "POST", body: JSON.stringify({ summary: "Hi" }) },
        { mode: "mutation", timeoutMs: 1000 }
      )

      // Then: it is uncertain, not failed, and is never sent twice.
      await expect(request).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
      await expect(request).rejects.toMatchObject({
        code: "google_mutation_ambiguous",
      })
      expect(calls).toBe(1)
    }
  )

  it("keeps safe-mode decoding unchanged", async () => {
    const { GoogleMutationAmbiguousError, googleRequest } = await import(
      "@/lib/server/google"
    )
    const read = () =>
      googleRequest<unknown>(
        "https://mybusiness.googleapis.com/v4/example",
        "access-token",
        {},
        { maxAttempts: 1, timeoutMs: 1000 }
      )

    // A non-JSON body is returned as text and an empty body as null.
    respond = undecodableSuccess["a non-JSON body"]
    await expect(read()).resolves.toBe("<html>Service</html>")
    respond = undecodableSuccess["an empty body"]
    await expect(read()).resolves.toBeNull()

    // A truncated JSON body or an aborted read is thrown as is: a read
    // changes nothing, so it is never reported as an uncertain write.
    respond = undecodableSuccess["a truncated JSON body"]
    await expect(read()).rejects.toBeInstanceOf(SyntaxError)
    respond = undecodableSuccess["a body-read abort"]
    const aborted = read()
    await expect(aborted).rejects.toBeInstanceOf(Error)
    await expect(aborted).rejects.not.toBeInstanceOf(
      GoogleMutationAmbiguousError
    )
  })

  it("accepts an empty answer to a DELETE mutation", async () => {
    respond = (response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end()
    }
    const { googleRequest } = await import("@/lib/server/google")

    const result = await googleRequest(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts/3",
      "access-token",
      { method: "DELETE" },
      { mode: "mutation", timeoutMs: 1000 }
    )

    expect(result).toBeNull()
  })

  it("accepts any 2xx answer when the caller ignores the success body", async () => {
    respond = undecodableSuccess["a non-JSON body"]
    const { googleRequest } = await import("@/lib/server/google")

    const result = await googleRequest(
      "https://mybusiness.googleapis.com/upload/v1/media/ref",
      "access-token",
      { method: "POST", body: "bytes" },
      { mode: "mutation", timeoutMs: 1000, successBody: "ignored" }
    )

    expect(result).toBe("<html>Service</html>")
  })

  it.each([
    ["a non-JSON", "text/html", "<html>Bad request</html>"],
    ["an unparseable JSON", "application/json", '{"error":'],
  ])(
    "keeps a 4xx mutation with %s body a confirmed failure",
    async (_name, contentType, body) => {
      // Given: Google rejects the write with an error body it garbled.
      respond = (response) => {
        response.writeHead(400, { "content-type": contentType })
        response.end(body)
      }
      const { GoogleMutationAmbiguousError, googleRequest } = await import(
        "@/lib/server/google"
      )

      // When: a mutation crosses the real HTTP transport.
      const request = googleRequest(
        "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts",
        "access-token",
        { method: "POST", body: "{}" },
        { mode: "mutation", timeoutMs: 1000 }
      )

      // Then: the status decides; nothing was written.
      await expect(request).rejects.toMatchObject({
        status: 400,
        code: "google_api_error",
      })
      await expect(request).rejects.not.toBeInstanceOf(
        GoogleMutationAmbiguousError
      )
    }
  )

  describe("inside a Google write session", () => {
    it("refuses a mutation that could not wait its full timeout, before sending it", async () => {
      // Given: a write session with less time left than the mutation timeout.
      const { googleRequest } = await import("@/lib/server/google")
      const { GoogleWriteBudgetExhaustedError, withGoogleWriteDeadline } =
        await import("@/lib/server/google/transport")

      // When: the mutation reaches the transport.
      const request = withGoogleWriteDeadline(Date.now() + 500, () =>
        googleRequest(
          "https://mybusiness.googleapis.com/v4/example",
          "access-token",
          { method: "PATCH", body: "{}" },
          { mode: "mutation", timeoutMs: 1000 }
        )
      )

      // Then: a plain, retryable failure, and Google never saw it.
      await expect(request).rejects.toBeInstanceOf(
        GoogleWriteBudgetExhaustedError
      )
      await expect(request).rejects.toMatchObject({
        status: 503,
        code: "google_write_budget_exhausted",
        retryable: true,
      })
      expect(calls).toBe(0)
    })

    it("ends a stalled read by the session deadline, not the call timeout", async () => {
      // Given: Google never answers, and the session ends well before the
      // call's own timeout.
      respond = () => undefined
      const { googleRequest } = await import("@/lib/server/google")
      const { withGoogleWriteDeadline } = await import(
        "@/lib/server/google/transport"
      )
      const startedAt = performance.now()

      // When: a safe read runs in the session.
      const request = withGoogleWriteDeadline(Date.now() + 200, () =>
        googleRequest(
          "https://mybusiness.googleapis.com/v4/example",
          "access-token",
          {},
          { timeoutMs: 1000 }
        )
      )

      // Then: it times out at the session deadline.
      await expect(request).rejects.toMatchObject({ code: "google_timeout" })
      expect(performance.now() - startedAt).toBeLessThan(800)
    })
  })

  it("does not sleep past its deadline for a Retry-After it cannot honour", async () => {
    // Given: Google asks for a retry later than the call's deadline.
    respond = (response) => {
      response.writeHead(503, {
        "content-type": "application/json",
        "retry-after": "5",
      })
      response.end(JSON.stringify({ error: { status: "UNAVAILABLE" } }))
    }
    const { googleRequest } = await import("@/lib/server/google")
    const startedAt = performance.now()

    // When: a safe read is retried.
    const request = googleRequest(
      "https://mybusiness.googleapis.com/v4/example",
      "access-token",
      {},
      { maxAttempts: 3, timeoutMs: 1000 }
    )

    // Then: Google's own answer is the error at once, with no second call;
    // the sleep used to run the call's full timeout first.
    await expect(request).rejects.toMatchObject({
      status: 503,
      code: "UNAVAILABLE",
    })
    expect(calls).toBe(1)
    expect(performance.now() - startedAt).toBeLessThan(500)
  })
})
