import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BREACHED_PASSWORD_MESSAGE,
  BREACHED_PASSWORD_TIMEOUT_MS,
  assertPasswordNotBreached,
  checkBreachedPassword,
} from "@/lib/server/breached-password"
import { ApiError } from "@/lib/server/http"

const env = vi.hoisted(() => ({
  PASSWORD_AUTH_ENABLED: true,
  BREACHED_PASSWORD_CHECK_ENABLED: true,
}))
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))

const PASSWORD = "correct horse battery staple"
const HASH = createHash("sha1").update(PASSWORD, "utf8").digest("hex").toUpperCase()
const PREFIX = HASH.slice(0, 5)
const SUFFIX = HASH.slice(5)

/** A suffix that is not ours but shares the prefix's shape. */
const OTHER = "0".repeat(SUFFIX.length)

function range(lines: string[], status = 200) {
  return new Response(lines.join("\r\n"), { status })
}

let fetchMock: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  env.PASSWORD_AUTH_ENABLED = true
  env.BREACHED_PASSWORD_CHECK_ENABLED = true
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("checkBreachedPassword", () => {
  it("sends only the five-character prefix, with padding and a timeout", async () => {
    fetchMock.mockResolvedValue(range([`${OTHER}:3`]))
    await checkBreachedPassword(PASSWORD)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    expect(new Headers(init.headers).get("Add-Padding")).toBe("true")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.method).toBe("GET")
    expect(init.body).toBeUndefined()
    // Neither the password nor the full hash nor the suffix goes anywhere.
    const sent = JSON.stringify([url, init])
    expect(sent).not.toContain(PASSWORD)
    expect(sent).not.toContain(SUFFIX)
    expect(sent.toLowerCase()).not.toContain(SUFFIX.toLowerCase())
  })

  it("keeps the timeout short", () => {
    expect(BREACHED_PASSWORD_TIMEOUT_MS).toBeLessThanOrEqual(3_000)
  })

  it("reports a hit when the suffix is listed with a count", async () => {
    fetchMock.mockResolvedValue(range([`${OTHER}:3`, `${SUFFIX}:42`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("breached")
  })

  it("matches the suffix whatever its case", async () => {
    fetchMock.mockResolvedValue(range([`${SUFFIX.toLowerCase()}:1`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("breached")
  })

  it("reports a miss when the suffix is not listed", async () => {
    fetchMock.mockResolvedValue(range([`${OTHER}:9`, "", "not a line"]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe(
      "not_breached"
    )
  })

  it("treats a padding entry (count 0) for our suffix as a miss", async () => {
    fetchMock.mockResolvedValue(range([`${OTHER}:0`, `${SUFFIX}:0`]))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe(
      "not_breached"
    )
  })

  it("fails open on a timeout and logs nothing derived from the password", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError")
    )
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain("auth.breached_password_check_unavailable")
    expect(line).not.toContain(PREFIX)
    expect(line).not.toContain(PASSWORD)
  })

  it("fails open on a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })

  it("fails open when the service answers with an error status", async () => {
    fetchMock.mockResolvedValue(range([`${SUFFIX}:42`], 503))
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })

  it("fails open when the body cannot be read", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.reject(new Error("aborted")),
    })
    await expect(checkBreachedPassword(PASSWORD)).resolves.toBe("unavailable")
  })
})

describe("assertPasswordNotBreached", () => {
  it("refuses a breached password as a field error on password", async () => {
    fetchMock.mockResolvedValue(range([`${SUFFIX}:42`]))
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
    fetchMock.mockResolvedValue(range([`${SUFFIX}:0`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
  })

  it("lets the password through when the service is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
  })

  it("makes no request when the flag is off", async () => {
    env.BREACHED_PASSWORD_CHECK_ENABLED = false
    fetchMock.mockResolvedValue(range([`${SUFFIX}:42`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("makes no request when password auth is off", async () => {
    env.PASSWORD_AUTH_ENABLED = false
    fetchMock.mockResolvedValue(range([`${SUFFIX}:42`]))
    await expect(assertPasswordNotBreached(PASSWORD)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
