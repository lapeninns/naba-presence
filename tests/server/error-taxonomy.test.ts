import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest"
import { z, ZodError } from "zod"

/**
 * The error taxonomy (W3-3, WP-05): the caller's own input failing its
 * schema is a 400; a provider body we cannot read is a 502; stored data or
 * a server-built value failing its schema is a 500. The two server-side
 * kinds log one structured line with the issue paths only, and the client
 * body never echoes the issues.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
const googleRequest = vi.fn()
vi.mock("@/lib/server/google/transport", () => ({
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}))

import { getGoogleHoursCategories } from "@/lib/server/google/locations"
import {
  apiError,
  InvariantError,
  parseStored,
  parseUpstream,
  UpstreamResponseError,
} from "@/lib/server/http"
import { route, type RouteHandler } from "@/lib/server/route"

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
})

let errors: MockInstance<typeof console.error>
let warnings: MockInstance<typeof console.error>

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {})
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {})
  googleRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function logLines(spy: MockInstance<typeof console.error>) {
  return spy.mock.calls.map(
    (call) => JSON.parse(String(call[0])) as Record<string, unknown>
  )
}

function call(handler: RouteHandler, init: RequestInit = {}) {
  return handler(new Request("http://localhost/api/test", init), {
    params: Promise.resolve({}),
  })
}

const schema = z.object({ name: z.string(), count: z.number() })
const SECRET = "reviewer-wrote-this@example.test"

describe("http.ts error mapping", () => {
  it("maps a provider body that fails its schema to 502, logged once without values", async () => {
    let thrown: unknown
    try {
      parseUpstream(
        schema,
        { name: SECRET, count: "x" },
        {
          provider: "google",
          operation: "locations.get",
        }
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UpstreamResponseError)
    const response = apiError(thrown, "request-1")
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toMatchObject({
      error: "google_invalid_response",
      requestId: "request-1",
      retryable: true,
    })
    expect(body).not.toHaveProperty("details")
    expect(body).not.toHaveProperty("fieldErrors")

    const lines = logLines(errors)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: "error",
      event: "api.upstream_invalid_response",
      provider: "google",
      operation: "locations.get",
      issues: [{ path: "count", code: "invalid_type" }],
    })
    expect(JSON.stringify(lines[0])).not.toContain(SECRET)
  })

  it("maps stored data that fails its schema to 500, logged once", async () => {
    let thrown: unknown
    try {
      parseStored(schema, { name: "x" }, "schedule.rule")
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(InvariantError)
    const response = apiError(thrown, "request-1")
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ error: "internal_error" })
    expect(body).not.toHaveProperty("details")
    expect(logLines(errors)).toEqual([
      expect.objectContaining({
        event: "api.invariant_violation",
        subject: "schedule.rule",
        issues: [{ path: "count", code: "invalid_type" }],
      }),
    ])
  })

  it("keeps an unclassified handler ZodError a 400, but logs it", async () => {
    const result = schema.safeParse({ name: "x" })
    const response = apiError(
      (result as { error: ZodError }).error,
      "request-1"
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: "invalid_request",
      fieldErrors: { count: expect.any(String) },
    })
    expect(logLines(warnings)).toEqual([
      expect.objectContaining({ event: "api.unclassified_validation_error" }),
    ])
    expect(errors).not.toHaveBeenCalled()
  })

  it("passes parsed values through unchanged", () => {
    const value = { name: "x", count: 1 }
    expect(
      parseUpstream(schema, value, { provider: "google", operation: "x" })
    ).toEqual(value)
    expect(parseStored(schema, value, "x")).toEqual(value)
    expect(errors).not.toHaveBeenCalled()
  })
})

describe("route() error taxonomy", () => {
  it("still answers a request-input failure with 400 and fieldErrors, unlogged", async () => {
    const POST = route({
      auth: "public",
      body: schema,
      handler: () => ({ ok: true }),
    })
    const response = await call(POST, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({
      error: "invalid_request",
      fieldErrors: { count: expect.any(String) },
    })
    // The same body as before: the issues are still in `details`.
    expect(body.details).toEqual([
      expect.objectContaining({ path: ["count"], code: "invalid_type" }),
    ])
    expect(warnings).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })

  it("answers a malformed Google payload with 502 and one structured log line", async () => {
    // Google's categories:batchGet with `categories` as an object, not a list.
    googleRequest.mockResolvedValue({ categories: { name: "gcid:pub" } })
    const GET = route({
      auth: "public",
      handler: async () => ({
        categories: await getGoogleHoursCategories("token", {
          names: ["gcid:pub"],
          languageCode: "en",
        }),
      }),
    })
    const response = await call(GET)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      error: "google_invalid_response",
    })
    const lines = logLines(errors)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: "api.upstream_invalid_response",
      provider: "google",
      operation: "categories.batchGet",
      issues: [{ path: "categories", code: "invalid_type" }],
    })
    expect(warnings).not.toHaveBeenCalled()
  })
})
