import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => ({}) }))
vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn() }))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  describeCreditsLeft,
  fillDailyCredits,
  formatResetDate,
} from "@/lib/contracts/ai-credits"
import { creditUsageFindings } from "@/lib/server/notifications/evaluate"
import { renderIncidentEmail } from "@/lib/server/notifications/messages"

const period = {
  periodStart: "2026-10-01",
  resetsAt: "2026-11-01T00:00:00.000Z",
}

describe("credit copy", () => {
  it("formats the reset date in UTC", () => {
    expect(formatResetDate(period.resetsAt)).toBe("1 Nov")
  })
  it("says what is left, or the exhausted sentence", () => {
    expect(
      describeCreditsLeft({ remaining: 7, allowance: 200, ...period })
    ).toBe("7 of 200 credits left this month")
    expect(
      describeCreditsLeft({ remaining: 0, allowance: 200, ...period })
    ).toBe(
      "Out of AI credits until 1 Nov. You can still write a reply yourself."
    )
  })
})

describe("fillDailyCredits", () => {
  it("returns every day to today, zero where nothing was spent", () => {
    expect(
      fillDailyCredits("2026-10-01", "2026-10-03", [
        { date: "2026-10-02", credits: 4 },
      ])
    ).toEqual([
      { date: "2026-10-01", credits: 0 },
      { date: "2026-10-02", credits: 4 },
      { date: "2026-10-03", credits: 0 },
    ])
  })
})

describe("creditUsageFindings", () => {
  const at = (used: number, allowance = 10) =>
    creditUsageFindings({ used, allowance, ...period })
  it("is silent below 80%", () => {
    expect(at(7)).toEqual({ ai_credits_low: [], ai_credits_exhausted: [] })
  })
  it("warns from 80% and keys the incident to the period", () => {
    const f = at(8)
    expect(f.ai_credits_low).toHaveLength(1)
    expect(f.ai_credits_low[0].subjectId).toBe("2026-10-01")
    expect(f.ai_credits_exhausted).toHaveLength(0)
  })
  it("switches to exhausted at 100%", () => {
    const f = at(10)
    expect(f.ai_credits_low).toHaveLength(0)
    expect(f.ai_credits_exhausted).toHaveLength(1)
  })
  it("ignores an allowance of zero", () => {
    expect(at(0, 0)).toEqual({ ai_credits_low: [], ai_credits_exhausted: [] })
  })
})

describe("credit emails", () => {
  it("never use agency or client wording", () => {
    for (const kind of ["ai_credits_low", "ai_credits_exhausted"] as const) {
      const { subject, text } = renderIncidentEmail(
        kind,
        { used: 8, allowance: 10, resetsOn: "1 November" },
        "https://app.example"
      )
      expect(`${subject}\n${text}`).not.toMatch(/client|agency/i)
      expect(text).toContain("1 November")
      expect(text).toContain("https://app.example/settings")
    }
  })
})

describe("migration 0060", () => {
  it("allows both credit incident kinds", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0060_ai_credit_notifications.sql"),
      "utf8"
    )
    expect(sql).toContain("'ai_credits_low'")
    expect(sql).toContain("'ai_credits_exhausted'")
  })
})
