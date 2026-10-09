import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { type RawParams, route, type RouteHandler } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))

const CRON_SECRET = "c".repeat(16)
const UUID = "00000000-0000-4000-8000-000000000001"

const session: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: UUID,
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@example.test",
  role: "member",
  canPublish: true,
}

function signedIn(value: Session | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (value ? { value: "token" } : undefined),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => value),
  } as never)
}

function request(
  path = "/api/test",
  init: RequestInit = {}
): Request {
  return new Request(`http://localhost${path}`, init)
}

function call(handler: RouteHandler, req: Request, params: RawParams = {}) {
  return handler(req, { params: Promise.resolve(params) })
}

function json(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test/some/path")
  vi.stubEnv("APP_ALLOWED_ORIGINS", "https://proxy.example.test")
})

beforeEach(() => {
  vi.clearAllMocks()
  signedIn({ ...session, role: "owner" })
  vi.mocked(withTenant).mockImplementation(async (_organisationId, fn) =>
    fn("sql" as never)
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("route() — responses", () => {
  it("wraps a plain value as JSON and echoes x-request-id", async () => {
    const GET = route({ handler: async () => ({ ok: true }) })
    const response = await call(GET, request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("passes a returned Response through untouched apart from the header", async () => {
    const POST = route({
      handler: async () => NextResponse.json({ created: true }, { status: 201 }),
    })
    const response = await call(POST, request())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ created: true })
    expect(response.headers.get("x-request-id")).toBeTruthy()
  })

  it("exposes the caller's x-request-id as clientRequestId", async () => {
    const GET = route({
      handler: async ({ requestId, clientRequestId }) => ({
        requestId,
        clientRequestId,
      }),
    })
    const response = await call(
      GET,
      request("/api/test", { headers: { "x-request-id": "client-1" } })
    )
    const body = await response.json()
    expect(body.clientRequestId).toBe("client-1")
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
  })
})

describe("route() — errors", () => {
  it("maps ApiError with the request id in body and header", async () => {
    const GET = route({
      handler: async () => {
        throw new ApiError(409, "review_restricted", "Restricted.", {
          retryable: true,
        })
      },
    })
    const response = await call(GET, request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toMatchObject({
      error: "review_restricted",
      message: "Restricted.",
      retryable: true,
    })
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
  })

  it("maps a Zod body failure to 400 invalid_request with fieldErrors", async () => {
    const POST = route({
      body: z.object({ name: z.string().min(1), tone: z.string().default("warm") }),
      handler: async ({ body }) => body,
    })
    const response = await call(POST, request("/api/test", json({ name: "" })))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe("invalid_request")
    expect(body.fieldErrors).toHaveProperty("name")
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
  })

  it("treats a missing or invalid JSON body as {} so defaults apply", async () => {
    const POST = route({
      body: z.object({ tone: z.string().default("warm") }),
      handler: async ({ body }) => body,
    })
    const empty = await call(POST, request("/api/test", { method: "POST" }))
    expect(await empty.json()).toEqual({ tone: "warm" })
    const invalid = await call(
      POST,
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    )
    expect(await invalid.json()).toEqual({ tone: "warm" })
  })

  it("maps unknown errors to 500 internal_error with the request id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const GET = route({
      handler: async () => {
        throw new Error("boom")
      },
    })
    const response = await call(GET, request())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe("internal_error")
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
  })
})

describe("route() — parsing", () => {
  it("validates path params against the schema", async () => {
    const GET = route({
      params: z.object({ id: z.uuid() }),
      handler: async ({ params }) => ({ id: params.id }),
    })
    const ok = await call(GET, request(), { id: UUID })
    expect(await ok.json()).toEqual({ id: UUID })
    const bad = await call(GET, request(), { id: "nope" })
    expect(bad.status).toBe(400)
    expect((await bad.json()).fieldErrors).toHaveProperty("id")
  })

  it("parses query with a zod schema (repeated keys become arrays)", async () => {
    const GET = route({
      query: z.object({
        locationId: z.uuid().optional(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
      }),
      handler: async ({ query }) => query,
    })
    const response = await call(
      GET,
      request(`/api/test?locationId=${UUID}&status=new&status=drafted`)
    )
    expect(await response.json()).toEqual({
      locationId: UUID,
      status: ["new", "drafted"],
    })
    const bad = await call(GET, request("/api/test?locationId=x"))
    expect(bad.status).toBe(400)
  })

  it("parses query with a function receiving the raw URLSearchParams", async () => {
    const GET = route({
      query: (searchParams) => ({
        batchSize: Number(searchParams.get("batch_size") ?? 25),
      }),
      handler: async ({ query }) => query,
    })
    const response = await call(GET, request("/api/test?batch_size=5"))
    expect(await response.json()).toEqual({ batchSize: 5 })
  })

  it("hands the raw URLSearchParams to the handler when no query is declared", async () => {
    const GET = route({
      handler: async ({ query }) => ({ value: query.get("x") }),
    })
    expect(await (await call(GET, request("/api/test?x=1"))).json()).toEqual({
      value: "1",
    })
  })
})

describe("route() — auth: session", () => {
  it("returns 401 authentication_required when there is no session", async () => {
    signedIn(null)
    const GET = route({ handler: async () => ({ ok: true }) })
    const response = await call(GET, request())
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe("authentication_required")
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
  })

  it("returns 403 permission_denied when the role is not allowed", async () => {
    signedIn({ ...session, role: "member" })
    const handler = vi.fn(async () => ({ ok: true }))
    const DELETE = route({ roles: ["owner", "admin"], handler })
    const response = await call(DELETE, request())
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("permission_denied")
    expect(handler).not.toHaveBeenCalled()
  })

  it("passes the session and a tenant runner bound to the organisation", async () => {
    signedIn({ ...session, role: "admin" })
    const GET = route({
      roles: ["owner", "admin"],
      handler: async ({ session, tenant }) =>
        tenant(async (sql) => ({ sql, role: session.role })),
    })
    const response = await call(GET, request())
    expect(await response.json()).toEqual({ sql: "sql", role: "admin" })
    expect(withTenant).toHaveBeenCalledWith(UUID, expect.any(Function))
  })
})

describe("route() — support impersonation attribution", () => {
  // An impersonation session carries the customer's own user id, so nothing a
  // handler writes can distinguish it. The wrapper is the only place that sees
  // both the session and every audit write.
  function auditingRoute() {
    const rows: Record<string, unknown>[] = []
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      rows.push(values.at(-1) as Record<string, unknown>)
      return Promise.resolve([])
    }) as unknown as TransactionSql
    ;(sql as unknown as { json: (v: unknown) => unknown }).json = (v) => v
    const GET = route({
      handler: async ({ session, tenant }) =>
        tenant(async () => {
          await writeAudit(sql, {
            organisationId: session.organisationId,
            actorUserId: session.userId,
            action: "legal_hold.released",
            subjectType: "review",
            subjectId: UUID,
            metadata: { released: true },
          })
          return { actorUserId: session.userId }
        }),
    })
    return { GET, rows }
  }

  it("marks every audit row an impersonated handler writes", async () => {
    signedIn({
      ...session,
      supportActor: "support@nabapresence.test",
      impersonationReason: "ticket 42",
    })
    const { GET, rows } = auditingRoute()
    const response = await call(GET, request())
    // Still the customer's own id in the column; the engineer is beside it.
    expect(await response.json()).toEqual({ actorUserId: session.userId })
    expect(rows[0]).toEqual({
      released: true,
      supportActor: "support@nabapresence.test",
      impersonationReason: "ticket 42",
    })
  })

  it("adds nothing for an ordinary session", async () => {
    signedIn(session)
    const { GET, rows } = auditingRoute()
    await call(GET, request())
    expect(rows[0]).toEqual({ released: true })
  })
})

describe("route() — same-origin guard", () => {
  const handler = vi.fn(async () => ({ ok: true }))

  function post(headers: Record<string, string>) {
    return request("/api/test", { method: "POST", headers })
  }

  it("refuses a cross-origin session POST with 403 cross_origin_request", async () => {
    const POST = route({ handler })
    const response = await call(POST, post({ origin: "https://evil.example" }))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("cross_origin_request")
    expect(handler).not.toHaveBeenCalled()
  })

  it("refuses an opaque null origin and a cross-site Sec-Fetch-Site", async () => {
    const POST = route({ handler })
    expect((await call(POST, post({ origin: "null" }))).status).toBe(403)
    for (const site of ["cross-site", "same-site"]) {
      const response = await call(POST, post({ "sec-fetch-site": site }))
      expect(response.status).toBe(403)
    }
  })

  it("accepts the request's own origin, NEXTAUTH_URL's and APP_ALLOWED_ORIGINS", async () => {
    const POST = route({ handler })
    for (const origin of [
      "http://localhost",
      "https://app.example.test",
      "https://proxy.example.test",
    ]) {
      const response = await call(POST, post({ origin }))
      expect(response.status).toBe(200)
    }
  })

  it("accepts the E2E harness on :3100, whose origin is the request's own", async () => {
    const POST = route({ handler })
    const response = await call(
      POST,
      new Request("http://127.0.0.1:3100/api/test", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3100" },
      })
    )
    expect(response.status).toBe(200)
  })

  it("lets a missing Origin through when Sec-Fetch-Site is same-origin or none", async () => {
    const POST = route({ handler })
    for (const site of ["same-origin", "none"]) {
      const response = await call(POST, post({ "sec-fetch-site": site }))
      expect(response.status).toBe(200)
    }
  })

  it("lets a non-browser caller with neither header through", async () => {
    const POST = route({ handler })
    expect((await call(POST, post({}))).status).toBe(200)
  })

  it("never checks safe methods", async () => {
    const GET = route({ handler })
    const response = await call(
      GET,
      request("/api/test", { headers: { origin: "https://evil.example" } })
    )
    expect(response.status).toBe(200)
  })

  it("leaves cron and public routes alone unless they opt in", async () => {
    const cron = route({ auth: "cron", handler })
    const cronResponse = await call(
      cron,
      post({
        origin: "https://evil.example",
        authorization: `Bearer ${CRON_SECRET}`,
      })
    )
    expect(cronResponse.status).toBe(200)
    const webhook = route({ auth: "public", handler })
    expect(
      (await call(webhook, post({ origin: "https://pubsub.example" }))).status
    ).toBe(200)
    const explicit = route({ auth: "public", origin: "any", handler })
    expect(
      (await call(explicit, post({ origin: "https://pubsub.example" }))).status
    ).toBe(200)
  })

  it("guards a public route that opts in, except for the cron bearer", async () => {
    const POST = route({ auth: "public", origin: "same", handler })
    const forged = await call(POST, post({ origin: "https://evil.example" }))
    expect(forged.status).toBe(403)
    expect((await forged.json()).error).toBe("cross_origin_request")
    const scheduler = await call(
      POST,
      post({
        "sec-fetch-site": "cross-site",
        authorization: `Bearer ${CRON_SECRET}`,
      })
    )
    expect(scheduler.status).toBe(200)
  })

  it("refuses a session route with origin: same before looking up the session", async () => {
    signedIn(null)
    const POST = route({ handler })
    const response = await call(POST, post({ origin: "https://evil.example" }))
    expect(response.status).toBe(403)
  })
})

describe("route() — JSON bodies", () => {
  const schema = z.object({ name: z.string().default("none") })

  it("returns 415 unsupported_media_type for a text/plain body", async () => {
    const POST = route({ body: schema, handler: async ({ body }) => body })
    const response = await call(
      POST,
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ name: "x" }),
      })
    )
    expect(response.status).toBe(415)
    expect((await response.json()).error).toBe("unsupported_media_type")
  })

  it("refuses a form-encoded body too", async () => {
    const POST = route({ body: schema, handler: async ({ body }) => body })
    const response = await call(
      POST,
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=x",
      })
    )
    expect(response.status).toBe(415)
  })

  it("accepts application/json with parameters and +json types", async () => {
    const POST = route({ body: schema, handler: async ({ body }) => body })
    for (const contentType of [
      "application/json; charset=utf-8",
      "application/merge-patch+json",
    ]) {
      const response = await call(
        POST,
        request("/api/test", {
          method: "POST",
          headers: { "content-type": contentType },
          body: JSON.stringify({ name: "x" }),
        })
      )
      expect(await response.json()).toEqual({ name: "x" })
    }
  })

  it("does not check the type of a route without a body schema", async () => {
    const POST = route({ handler: async () => ({ ok: true }) })
    const response = await call(
      POST,
      request("/api/test", { method: "POST", body: "anything" })
    )
    expect(response.status).toBe(200)
  })
})

describe("route() — auth: cron", () => {
  it("accepts the CRON_SECRET bearer token without touching the session", async () => {
    const POST = route({
      auth: "cron",
      handler: async ({ session }) => ({ session }),
    })
    const response = await call(
      POST,
      request("/api/test", {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: null })
    expect(cookies).not.toHaveBeenCalled()
  })

  it.each([
    ["wrong token", `Bearer ${"x".repeat(16)}`],
    ["missing header", undefined],
  ])("rejects a %s with 401 invalid_cron_token", async (_label, header) => {
    const handler = vi.fn(async () => ({ ok: true }))
    const POST = route({ auth: "cron", handler })
    const response = await call(
      POST,
      request("/api/test", {
        method: "POST",
        headers: header ? { authorization: header } : {},
      })
    )
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe("invalid_cron_token")
    expect(body.requestId).toBe(response.headers.get("x-request-id"))
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("route() — auth: public", () => {
  it("runs without a session", async () => {
    signedIn(null)
    const GET = route({
      auth: "public",
      params: z.object({ token: z.string().min(1) }),
      handler: async ({ session, params }) => ({ session, token: params.token }),
    })
    const response = await call(GET, request(), { token: "abc" })
    expect(await response.json()).toEqual({ session: null, token: "abc" })
    expect(cookies).not.toHaveBeenCalled()
  })
})

describe("route() — compile-time contract", () => {
  it("rejects roles outside auth: session and narrows session per mode", () => {
    route({
      auth: "cron",
      // @ts-expect-error roles are only accepted with auth: "session"
      roles: ["owner"],
      handler: async () => null,
    })
    route({
      auth: "public",
      // @ts-expect-error session is null for public routes
      handler: async ({ session }) => ({ id: session.organisationId }),
    })
    route({
      handler: async ({ session, tenant }) =>
        tenant(async () => ({ id: session.organisationId })),
    })
    expect(true).toBe(true)
  })
})
