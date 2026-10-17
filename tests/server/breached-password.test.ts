import { createHash } from "node:crypto"
import { request } from "node:https"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BREACHED_PASSWORD_MESSAGE,
  BREACHED_PASSWORD_TIMEOUT_MS,
  BREACHED_PASSWORD_USER_AGENT,
  assertPasswordNotBreached,
  checkBreachedPassword,
} from "@/lib/server/breached-password"
import { ApiError } from "@/lib/server/http"
import {
  type FakeRangeRequest,
  type RangeReply,
  fakeRangeRequest,
  rangeBody,
} from "../helpers/fake-range-request"

const env = vi.hoisted(() => ({
  PASSWORD_AUTH_ENABLED: true,
  BREACHED_PASSWORD_CHECK_ENABLED: true,
}))
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))
vi.mock("node:https", () => ({ request: vi.fn() }))

const PASSWORD = "correct horse battery staple"
const HASH = createHash("sha1")
  .update(PASSWORD, "utf8")
  .digest("hex")
  .toUpperCase()
const PREFIX = HASH.slice(0, 5)
const SUFFIX = HASH.slice(5)

/** A suffix that is not ours but shares the prefix's shape. */
const OTHER = "0".repeat(SUFFIX.length)

let sent: FakeRangeRequest[]
let warn: ReturnType<typeof vi.spyOn>

function answer(reply: RangeReply | ((options: never) => RangeReply)) {
  vi.mocked(request).mockImplementation(
    fakeRangeRequest(reply as RangeReply, sent)
  )
}

function range(records: string[], status = 200): RangeReply {
  return { status, body: rangeBody(records) }
}

beforeEach(() => {
  env.PASSWORD_AUTH_ENABLED = true
  env.BREACHED_PASSWORD_CHECK_ENABLED = true
  sent = []
  vi.mocked(request).mockClear()
  answer(range([`${OTHER}:3`]))
  // Next.js and @vercel/otel trace the global fetch; the check must not use it.
  vi.stubGlobal("fetch", vi.fn())
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("checkBreachedPassword", () => {
  it("sends only the five-character prefix, with padding and an identifying User-Agent", async () => {
    await checkBreachedPassword(PASSWORD)
    expect(sent).toHaveLength(1)
    const { options } = sent[0]!
    expect(options.host).toBe("api.pwnedpasswords.com")
    expect(options.path).toBe(`/range/${PREFIX}`)
    expect(options.method).toBe("GET")
    // https is the module's own default; no port, protocol or agent override.
    expect(options).not.toHaveProperty("protocol")
    expect(options).not.toHaveProperty("port")
    expect(options.headers).toEqual({
      "Add-Padding": "true",
      "User-Agent": "NabaPresence-PasswordCheck",
    })
    expect(BREACHED_PASSWORD_USER_AGENT).toBe("NabaPresence-PasswordCheck")
    // Neither the password nor the full hash nor the suffix goes anywhere.
    const outgoing = JSON.stringify(options)
    expect(outgoing).not.toContain(PASSWORD)
    expect(outgoing.toUpperCase()).not.toContain(SUFFIX)
  })

  it("never goes through the global fetch, which Next.js traces with the URL", async () => {
    await checkBreachedPassword(PASSWORD)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("still finds a hit when the service refuses requests that do not identify themselves", async () => {
    // The API may answer 403 to a missing or generic User-Agent, which would
    // otherwise fail open on every check.
    answer((options: { headers?: Record<string, string> }) =>
      options.headers?.["User-Agent"] === BREACHED_PASSWORD_USER_AGENT
        ? range([`${SUFFIX}:42`])
        : range([], 403)
    )
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("breached")
    expect(warn).not.toHaveBeenCalled()
  })

  it("keeps the timeout short", () => {
    expect(BREACHED_PASSWORD_TIMEOUT_MS).toBeLessThanOrEqual(3_000)
  })

  it("reports a hit when the suffix is listed with a count", async () => {
    answer(range([`${OTHER}:3`, `${SUFFIX}:42`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("breached")
  })

  it("matches the suffix whatever its case", async () => {
    answer(range([`${SUFFIX.toLowerCase()}:1`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("breached")
  })

  it("reports a miss when the suffix is not listed", async () => {
    answer(range([`${OTHER}:9`, ""]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("not_breached")
    expect(warn).not.toHaveBeenCalled()
  })

  it("treats a padding entry (count 0) for our suffix as a miss", async () => {
    answer(range([`${OTHER}:0`, `${SUFFIX}:0`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("not_breached")
  })

  it("fails open on a timeout, gives up on the request and logs nothing derived from the password", async () => {
    vi.useFakeTimers()
    answer("hang")
    const result = checkBreachedPassword(PASSWORD)
    await vi.advanceTimersByTimeAsync(BREACHED_PASSWORD_TIMEOUT_MS)
    await expect(result).resolves.toBe("unavailable")
    expect(sent[0]?.destroyed).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain("auth.breached_password_check_unavailable")
    expect(line).not.toContain(PREFIX)
    expect(line).not.toContain(PASSWORD)
  })

  it("fails open on a network error", async () => {
    answer({ error: new Error("getaddrinfo ENOTFOUND") })
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })

  it("fails open when the service answers with an error status", async () => {
    answer(range([`${SUFFIX}:42`], 503))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })

  it("fails open when the body breaks off", async () => {
    answer({ bodyError: new Error("aborted") })
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })

  it.each([
    ["an empty body", ""],
    ["an HTML page", "<!doctype html><title>Gateway</title>"],
    ["a record with a bad suffix", `${OTHER}:3\r\nnot a record`],
    ["a record with no count", `${SUFFIX}:`],
  ])("treats a 200 with %s as unavailable, not as a miss", async (_, body) => {
    answer({ status: 200, body })
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("treats an oversized body as unavailable", async () => {
    answer(range(Array.from({ length: 30_000 }, () => `${OTHER}:1`)))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })
})

describe("assertPasswordNotBreached", () => {
  it("refuses a breached password as a field error on password", async () => {
    answer(range([`${SUFFIX}:42`]))
    const error = await assertPasswordNotBreached(PASSWORD).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.code).toBe("invalid_request")
    expect(error.fieldErrors).toEqual({ password: BREACHED_PASSWORD_MESSAGE })
    expect(error.details).toEqual([
      {
        code: "password_breached",
        path: ["password"],
        message: BREACHED_PASSWORD_MESSAGE,
      },
    ])
  })

  it("lets a password through that is not listed", async () => {
    answer(range([`${SUFFIX}:0`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
  })

  it("lets the password through when the service is unavailable", async () => {
    answer({ error: new Error("ECONNRESET") })
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
  })

  it("makes no request when the flag is off", async () => {
    env.BREACHED_PASSWORD_CHECK_ENABLED = false
    answer(range([`${SUFFIX}:42`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it("makes no request when password auth is off", async () => {
    env.PASSWORD_AUTH_ENABLED = false
    answer(range([`${SUFFIX}:42`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })
})
