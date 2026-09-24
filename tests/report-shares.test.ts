import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_REPORT_SHARE_EXPIRY_DAYS,
  parseSharePeriod,
  reportShareCreateSchema,
  SHARE_PERIODS,
} from "@/lib/contracts/report-shares"
import {
  createReportShareToken,
  isWellFormedReportShareToken,
  reportShareStatus,
  reportShareUrl,
  resolveReportShare,
} from "@/lib/server/report-shares"

const getDatabase = vi.fn()
vi.mock("@/lib/server/db", () => ({
  getDatabase: () => getDatabase(),
  withTenant: vi.fn(),
}))

describe("report share tokens", () => {
  it("are 32 random bytes as unpadded base64url", () => {
    const { token } = createReportShareToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, "base64url")).toHaveLength(32)
  })

  it("are different every time", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => createReportShareToken().token)
    )
    expect(tokens.size).toBe(200)
  })

  it("are stored as their SHA-256 hex digest only", () => {
    const { token, tokenHash } = createReportShareToken()
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"))
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).not.toContain(token)
  })

  it.each([
    ["", false],
    ["short", false],
    ["a".repeat(42), false],
    ["a".repeat(44), false],
    [`${"a".repeat(42)}=`, false],
    [`${"a".repeat(42)}/`, false],
    [`${"a".repeat(42)}.`, false],
    ["a".repeat(43), true],
    [`${"A-_9".repeat(10)}xyz`, true],
  ])("recognises %j as well-formed: %s", (value, expected) => {
    expect(isWellFormedReportShareToken(value)).toBe(expected)
  })

  it("refuses non-strings", () => {
    expect(isWellFormedReportShareToken(undefined)).toBe(false)
    expect(isWellFormedReportShareToken(["a".repeat(43)])).toBe(false)
  })

  it("builds the public path under /share/report/", () => {
    expect(reportShareUrl("abc", "https://app.example.test/some/page")).toBe(
      "https://app.example.test/share/report/abc"
    )
  })
})

describe("resolveReportShare", () => {
  it("never queries the database for a malformed token", async () => {
    await expect(resolveReportShare("../../etc")).resolves.toBeNull()
    await expect(resolveReportShare(undefined)).resolves.toBeNull()
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it("looks up the SHA-256 of the token, never the token", async () => {
    const calls: unknown[][] = []
    getDatabase.mockReturnValue(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push([strings.join("?"), ...values])
        return Promise.resolve([])
      }
    )
    const { token, tokenHash } = createReportShareToken()
    await expect(resolveReportShare(token)).resolves.toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain("lookup_report_share(")
    expect(calls[0].slice(1)).toEqual([tokenHash])
    expect(JSON.stringify(calls)).not.toContain(token)
  })
})

describe("reportShareStatus", () => {
  const now = new Date("2026-09-24T12:00:00Z")
  it("is revoked once revoked, whatever the expiry", () => {
    expect(
      reportShareStatus(
        {
          revokedAt: new Date("2026-09-01T00:00:00Z"),
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        },
        now
      )
    ).toBe("revoked")
  })
  it("is expired at and after the expiry instant", () => {
    expect(reportShareStatus({ revokedAt: null, expiresAt: now }, now)).toBe(
      "expired"
    )
  })
  it("is active before it", () => {
    expect(
      reportShareStatus(
        { revokedAt: null, expiresAt: new Date("2026-09-25T00:00:00Z") },
        now
      )
    ).toBe("active")
  })
})

describe("the create body", () => {
  it("defaults to 90 days", () => {
    expect(reportShareCreateSchema.parse({})).toEqual({
      expiresInDays: DEFAULT_REPORT_SHARE_EXPIRY_DAYS,
    })
    expect(DEFAULT_REPORT_SHARE_EXPIRY_DAYS).toBe(90)
  })
  it.each([30, 90, 365])("accepts %i days", (days) => {
    expect(reportShareCreateSchema.parse({ expiresInDays: days })).toEqual({
      expiresInDays: days,
    })
  })
  it.each([0, 1, 7, 91, 366, 3650, -30, "90", null])("refuses %j", (days) => {
    expect(() =>
      reportShareCreateSchema.parse({ expiresInDays: days })
    ).toThrow()
  })
})

describe("parseSharePeriod", () => {
  it("offers exactly 28 days, 90 days and 12 months", () => {
    expect(SHARE_PERIODS.map((period) => period.id)).toEqual([
      "28d",
      "90d",
      "12m",
    ])
  })
  it.each(["28d", "90d", "12m"])("keeps %s", (value) => {
    expect(parseSharePeriod(value)).toBe(value)
  })
  it.each([
    undefined,
    null,
    "",
    "18m",
    "1d",
    "28D",
    " 28d",
    "all",
    ["90d"],
    ["90d", "12m"],
    { id: "90d" },
  ])("reads %j as the default, last 28 days", (value) => {
    expect(parseSharePeriod(value)).toBe("28d")
  })
})
