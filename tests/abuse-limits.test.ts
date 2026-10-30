import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ABUSE_POLICIES,
  abuseKeyHash,
  checkAbuseBudget,
  clientIpFromHeaders,
  normaliseClientIp,
  takeAbuseBudget,
} from "@/lib/server/abuse-limits"
import { getDatabase } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"

vi.mock("@/lib/server/db", () => ({ getDatabase: vi.fn() }))
const testEnv = {
  ABUSE_LIMITS_ENABLED: true,
  CLIENT_IP_HEADER: undefined as string | undefined,
  NEXTAUTH_SECRET: "n".repeat(40),
}
vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  getServerEnv: () => testEnv,
}))

type Call = { scope: string; keyHash: string; limit: number; window: number }

/** A database whose take_abuse_budget answers from `answer`, recording calls. */
function database(answer: (call: Call) => [boolean, number]) {
  const calls: Call[] = []
  vi.mocked(getDatabase).mockReturnValue(((
    _strings: TemplateStringsArray,
    scope: string,
    keyHash: string,
    limit: number,
    window: number
  ) => {
    const call = { scope, keyHash, limit, window }
    calls.push(call)
    const [allowed, retryAfterSeconds] = answer(call)
    return Promise.resolve([{ allowed, retryAfterSeconds }])
  }) as never)
  return calls
}

beforeEach(() => {
  testEnv.ABUSE_LIMITS_ENABLED = true
  testEnv.CLIENT_IP_HEADER = undefined
  vi.unstubAllEnvs()
  vi.mocked(getDatabase).mockReset()
})

describe("client IP extraction", () => {
  it("takes the first hop of the trusted platform header", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1",
    })
    expect(clientIpFromHeaders(headers, "x-vercel-forwarded-for")).toBe(
      "203.0.113.7"
    )
  })

  it("ignores a spoofed x-forwarded-for when the platform header is present", () => {
    vi.stubEnv("VERCEL", "1")
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.99",
      "x-vercel-forwarded-for": "203.0.113.7",
    })
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7")
  })

  it("trusts no header off Vercel unless one is configured", () => {
    vi.stubEnv("VERCEL", "")
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.99",
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-real-ip": "198.51.100.98",
    })
    expect(clientIpFromHeaders(headers)).toBeNull()
    testEnv.CLIENT_IP_HEADER = "x-real-ip"
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.98")
  })

  it("refuses values that are not addresses", () => {
    const header = "x-vercel-forwarded-for"
    for (const value of ["unknown", "", "203.0.113", "<script>", "a, b"]) {
      expect(
        clientIpFromHeaders(new Headers({ [header]: value }), header)
      ).toBeNull()
    }
    expect(clientIpFromHeaders(new Headers(), header)).toBeNull()
  })

  it("groups IPv6 by /64 and unwraps IPv4-mapped addresses", () => {
    expect(normaliseClientIp("2001:db8:aa:bb:1:2:3:4")).toBe(
      "2001:db8:aa:bb::/64"
    )
    expect(normaliseClientIp("2001:DB8:aa:bb::9")).toBe("2001:db8:aa:bb::/64")
    expect(normaliseClientIp("[2001:db8::1]")).toBe("2001:db8:0:0::/64")
    expect(normaliseClientIp("::ffff:192.0.2.1")).toBe("192.0.2.1")
    expect(normaliseClientIp("::1")).toBe("0:0:0:0::/64")
  })
})

describe("key hashing", () => {
  const secret = "s".repeat(40)

  it("is stable, keyed and never the plaintext", () => {
    const hash = abuseKeyHash("email", "ada@example.test", secret)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("ada")
    expect(abuseKeyHash("email", "ada@example.test", secret)).toBe(hash)
    expect(abuseKeyHash("email", "ada@example.test", "t".repeat(40))).not.toBe(
      hash
    )
  })

  it("treats emails case- and space-insensitively", () => {
    expect(abuseKeyHash("email", "  Ada@Example.TEST ", secret)).toBe(
      abuseKeyHash("email", "ada@example.test", secret)
    )
  })

  it("separates kinds that share a value", () => {
    expect(abuseKeyHash("user", "x", secret)).not.toBe(
      abuseKeyHash("token", "x", secret)
    )
  })
})

describe("takeAbuseBudget", () => {
  it("counts each limited key under its own scope and window", async () => {
    const calls = database(() => [true, 0])
    await takeAbuseBudget("login", {
      ip: "203.0.113.7",
      email: "ada@example.test",
      user: "ignored: login does not limit users",
    })
    expect(calls).toEqual([
      {
        scope: "login_ip",
        keyHash: abuseKeyHash("ip", "203.0.113.7", testEnv.NEXTAUTH_SECRET),
        limit: ABUSE_POLICIES.login.ip.limit,
        window: ABUSE_POLICIES.login.ip.windowSeconds,
      },
      {
        scope: "login_email",
        keyHash: abuseKeyHash(
          "email",
          "ada@example.test",
          testEnv.NEXTAUTH_SECRET
        ),
        limit: ABUSE_POLICIES.login.email.limit,
        window: ABUSE_POLICIES.login.email.windowSeconds,
      },
    ])
  })

  it("skips a missing IP and still limits the email", async () => {
    const calls = database(() => [true, 0])
    await takeAbuseBudget("login", { ip: null, email: "ada@example.test" })
    expect(calls.map((call) => call.scope)).toEqual(["login_email"])
  })

  it("answers 429 with the longest retry when any key is over", async () => {
    database((call) => (call.scope === "login_ip" ? [false, 30] : [false, 600]))
    const error = await takeAbuseBudget("login", {
      ip: "203.0.113.7",
      email: "ada@example.test",
    }).catch((caught: unknown) => caught)
    const response = apiError(error, "req-1")
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("600")
    expect(await response.json()).toMatchObject({
      error: "auth_rate_limited",
      retryable: true,
      details: { retryAfter: 600 },
    })
  })

  it("uses the draft code for AI generation", async () => {
    database(() => [false, 45])
    await expect(
      takeAbuseBudget("ai_draft", { user: "u", organisation: "o" })
    ).rejects.toMatchObject({ status: 429, code: "draft_rate_limited" })
  })

  it("keeps the public review link's bucket: review_link_ip, 120 opens per 15 minutes", async () => {
    const calls = database(() => [true, 0])
    await checkAbuseBudget("review_link", { ip: "203.0.113.7" })
    expect(calls).toEqual([
      {
        scope: "review_link_ip",
        keyHash: abuseKeyHash("ip", "203.0.113.7", testEnv.NEXTAUTH_SECRET),
        limit: 120,
        window: 15 * 60,
      },
    ])
  })

  it("counts nothing when switched off", async () => {
    testEnv.ABUSE_LIMITS_ENABLED = false
    const calls = database(() => [false, 1])
    await expect(
      checkAbuseBudget("login", { ip: "203.0.113.7", email: "a@b.test" })
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(calls).toHaveLength(0)
  })
})
