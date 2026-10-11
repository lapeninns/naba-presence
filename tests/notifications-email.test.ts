import { once } from "node:events"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({
  baseUrl: "http://127.0.0.1:9",
  paused: false,
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    EMAIL_PROVIDER: "resend",
    EMAIL_API_KEY: "test-only-email-key",
    EMAIL_FROM: "NabaPresence <alerts@nabapresence.test>",
    EMAIL_API_BASE_URL: settings.baseUrl,
    TENANT_EMAIL_ENABLED: true,
  }),
}))
vi.mock("@/lib/server/pause-controls", () => ({
  isScopeEnabled: vi.fn(async () => !settings.paused),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import {
  IDEMPOTENCY_WINDOW_MS,
  runDeliveries,
  settleSend,
  type Settlement,
} from "@/lib/server/notifications/delivery"
import {
  classifySendError,
  sendEmail,
  type SendResult,
} from "@/lib/server/notifications/email"
import { isScopeEnabled } from "@/lib/server/pause-controls"

const message = { to: "ops@example.test", subject: "Alert", text: "Body" }

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe("sendEmail failure classification", () => {
  let server: Server | null = null

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (server) {
      server.closeAllConnections()
      server.close()
      server = null
    }
  })

  it("records a refused connection as a retryable failure: nothing was sent", async () => {
    // Bind a port, then free it: connecting to it is refused.
    server = createServer()
    settings.baseUrl = await listen(server)
    server.close()
    await once(server, "close")
    server = null
    expect(await sendEmail(message)).toEqual({
      status: "failed",
      code: "email_connect_failed",
      retryable: true,
    })
  })

  it("records a connection dropped after the request as uncertain", async () => {
    let received = 0
    server = createServer((request) => {
      received += 1
      // The provider read the request and the connection died before any
      // response: it may have queued the email.
      request.on("data", () => undefined)
      request.on("end", () => request.socket.destroy())
    })
    settings.baseUrl = await listen(server)
    expect(await sendEmail(message, { idempotencyKey: "k-1" })).toEqual({
      status: "uncertain",
      code: "email_connection_lost",
    })
    expect(received).toBe(1)
  })

  it("records a timeout after dispatch as uncertain, not failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError")
      })
    )
    expect(await sendEmail(message)).toEqual({
      status: "uncertain",
      code: "email_timeout",
    })
  })

  it("classifies by the error's cause chain and treats the unknown as uncertain", () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    })
    expect(classifySendError(refused)).toMatchObject({ status: "failed" })
    const dns = new TypeError("fetch failed", {
      cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }),
    })
    expect(classifySendError(dns)).toMatchObject({ status: "failed" })
    const reset = new TypeError("fetch failed", {
      cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    })
    expect(classifySendError(reset)).toEqual({
      status: "uncertain",
      code: "email_connection_lost",
    })
    expect(classifySendError(new Error("??"))).toMatchObject({
      status: "uncertain",
    })
  })

  it("keeps HTTP refusals as failures, retryable only for 429 and 5xx", async () => {
    let status = 500
    server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end("{}")
    })
    settings.baseUrl = await listen(server)
    expect(await sendEmail(message)).toEqual({
      status: "failed",
      code: "email_http_500",
      retryable: true,
    })
    status = 422
    expect(await sendEmail(message)).toEqual({
      status: "failed",
      code: "email_http_422",
      retryable: false,
    })
  })
})

describe("settleSend", () => {
  const now = new Date("2026-10-11T12:00:00Z")
  const fresh = { attempts: 1, createdAt: new Date(now.getTime() - 60_000) }

  it("settles sent and suppressed at once", () => {
    expect(
      settleSend({ status: "sent", providerMessageId: "m-1" }, fresh, { now })
    ).toEqual({
      status: "sent",
      evidence: "accepted",
      errorCode: null,
      providerMessageId: "m-1",
      retryInMinutes: null,
    })
    expect(
      settleSend(
        { status: "suppressed", reason: "provider_not_configured" },
        fresh,
        { now }
      )
    ).toMatchObject({
      status: "suppressed",
      evidence: "suppressed",
      errorCode: "provider_not_configured",
    })
  })

  it("retries a retryable refusal with back-off until the attempt limit, then fails", () => {
    const refusal: SendResult = {
      status: "failed",
      code: "email_http_503",
      retryable: true,
    }
    expect(
      settleSend(refusal, { ...fresh, attempts: 2 }, { now })
    ).toMatchObject({
      status: "pending",
      evidence: "queued",
      retryInMinutes: 4,
    })
    expect(
      settleSend(refusal, { ...fresh, attempts: 5 }, { now })
    ).toMatchObject({
      status: "failed",
      evidence: "failed",
      errorCode: "email_http_503",
    })
    expect(
      settleSend(
        { status: "failed", code: "email_http_422", retryable: false },
        fresh,
        { now }
      )
    ).toMatchObject({ status: "failed" })
  })

  it("retries an uncertain send only while its idempotency key protects it", () => {
    const uncertain: SendResult = { status: "uncertain", code: "email_timeout" }
    expect(settleSend(uncertain, fresh, { now })).toMatchObject({
      status: "pending",
      retryInMinutes: 2,
    })
    const old = {
      attempts: 1,
      createdAt: new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS),
    }
    expect(settleSend(uncertain, old, { now })).toEqual({
      status: "uncertain",
      evidence: "unknown",
      errorCode: "email_timeout",
      providerMessageId: null,
      retryInMinutes: null,
    })
    expect(
      settleSend(uncertain, { ...fresh, attempts: 5 }, { now })
    ).toMatchObject({
      status: "uncertain",
      evidence: "unknown",
    })
  })
})

describe("runDeliveries", () => {
  type Row = { id: string; attempts: number; createdAt: Date }
  const row = (id: string): Row => ({ id, attempts: 1, createdAt: new Date() })

  beforeEach(() => {
    settings.paused = false
    vi.mocked(isScopeEnabled).mockClear()
  })

  it("claims nothing while its pause scope is paused", async () => {
    settings.paused = true
    const claim = vi.fn(async () => [row("a")])
    const outcome = await runDeliveries({
      name: "invitation_delivery",
      scopes: ["invitation_email"],
      claim,
      send: vi.fn(),
      settle: vi.fn(),
    })
    expect(outcome).toEqual({
      sent: 0,
      suppressed: 0,
      failed: 0,
      uncertain: 0,
      paused: true,
    })
    expect(claim).not.toHaveBeenCalled()
    expect(isScopeEnabled).toHaveBeenCalledWith(["invitation_email"])
  })

  it("settles every claimed row by its own result and counts each state", async () => {
    const results: Record<string, SendResult> = {
      a: { status: "sent", providerMessageId: "m-a" },
      b: { status: "suppressed", reason: "recipient_not_member" },
      c: { status: "failed", code: "email_http_503", retryable: true },
      d: { status: "uncertain", code: "email_timeout" },
    }
    const settled: Record<string, Settlement> = {}
    const outcome = await runDeliveries<Row>({
      name: "test",
      claim: async () => ["a", "b", "c", "d"].map(row),
      send: async (item) => results[item.id]!,
      settle: async (item, settlement) => {
        settled[item.id] = settlement
      },
    })
    expect(outcome).toEqual({
      sent: 1,
      suppressed: 1,
      failed: 1,
      uncertain: 1,
      paused: false,
    })
    expect(
      Object.fromEntries(
        Object.entries(settled).map(([id, s]) => [id, s.status])
      )
    ).toEqual({
      a: "sent",
      b: "suppressed",
      c: "pending",
      d: "pending",
    })
  })
})
