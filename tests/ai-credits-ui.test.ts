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
  aiCreditsBlocked,
  aiCreditsSchema,
  describeCreditsLeft,
  fillDailyCredits,
  formatResetDate,
} from "@/lib/contracts/ai-credits"
import { creditUsageFindings } from "@/lib/server/notifications/evaluate"
import { renderIncidentEmail } from "@/lib/server/notifications/messages"

const PERIOD_ID = "00000000-0000-4000-8000-0000000000e1"
const period = {
  periodId: PERIOD_ID,
  periodKind: "pilot_month" as const,
  periodEnd: "2026-11-01T00:00:00.000Z",
  canUseAi: true,
}

describe("the credits payload's AI signal (INB-14)", () => {
  const base = {
    used: 0,
    allowance: 200,
    remaining: 200,
    periodId: PERIOD_ID,
    periodKind: "pilot_month" as const,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    canUseAi: true,
    accessReason: "pilot" as const,
  }

  it("is additive: an older server without it still parses, and an explicit false is kept", () => {
    expect(aiCreditsSchema.parse(base).aiConfigured).toBeUndefined()
    expect(
      aiCreditsSchema.parse({ ...base, aiConfigured: false }).aiConfigured
    ).toBe(false)
  })
})

describe("credit copy", () => {
  it("formats the reset date in UTC", () => {
    expect(formatResetDate(period.periodEnd)).toBe("1 Nov")
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
  it("says 'this period' outside a pilot month, with the row's end", () => {
    expect(
      describeCreditsLeft({
        remaining: 3,
        allowance: 50,
        ...period,
        periodKind: "paid_period",
      })
    ).toBe("3 of 50 credits left this period")
    expect(
      describeCreditsLeft({
        remaining: 0,
        allowance: 50,
        ...period,
        periodKind: "trial",
        periodEnd: "2026-10-25T09:30:00.000Z",
      })
    ).toBe(
      "Out of AI credits until 25 Oct. You can still write a reply yourself."
    )
  })
  it("reports an unknown allowance as unknown, never as zero", () => {
    const unknown = {
      remaining: null,
      allowance: null,
      ...period,
      periodId: null,
      periodKind: null,
      periodEnd: null,
    }
    expect(describeCreditsLeft(unknown)).toBe(
      "Your AI credit allowance is not confirmed yet, so AI drafting is off for now. You can still write a reply yourself."
    )
    expect(aiCreditsBlocked(unknown)).toBe(true)
  })
  it("turns AI off while billing is read-only, whatever is left", () => {
    const readOnly = {
      remaining: 10,
      allowance: 10,
      ...period,
      canUseAi: false,
    }
    expect(aiCreditsBlocked(readOnly)).toBe(true)
    expect(describeCreditsLeft(readOnly)).toMatch(/read-only/)
    expect(aiCreditsBlocked({ ...readOnly, canUseAi: true })).toBe(false)
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
  it("warns from 80% and keys the incident to the credit period id", () => {
    const f = at(8)
    expect(f.ai_credits_low).toHaveLength(1)
    expect(f.ai_credits_low[0].subjectId).toBe(PERIOD_ID)
    expect(f.ai_credits_low[0].summary).toMatchObject({
      period: "month",
      resetsOn: "1 November",
    })
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
  it("raises nothing for an unknown allowance or no period", () => {
    const none = { ai_credits_low: [], ai_credits_exhausted: [] }
    expect(
      creditUsageFindings({ used: 9, ...period, allowance: null })
    ).toEqual(none)
    expect(
      creditUsageFindings({ used: 9, allowance: 10, ...period, periodId: null })
    ).toEqual(none)
  })
  it("names a paid period in the summary", () => {
    const f = creditUsageFindings({
      used: 10,
      allowance: 10,
      ...period,
      periodKind: "paid_period",
    })
    expect(f.ai_credits_exhausted[0].summary).toMatchObject({
      period: "period",
    })
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
      expect(`${subject}\n${text}`).toContain("this month")
    }
  })
  it("say 'this period' for a paid period", () => {
    const { subject, text } = renderIncidentEmail(
      "ai_credits_exhausted",
      { used: 10, allowance: 10, period: "period", resetsOn: "14 November" },
      "https://app.example"
    )
    expect(subject).toBe("You are out of AI reply credits this period")
    expect(text).not.toContain("month")
  })
})

describe("migration 0060", () => {
  it("allows both credit incident kinds", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/0060_ai_credit_notifications.sql"
      ),
      "utf8"
    )
    expect(sql).toContain("'ai_credits_low'")
    expect(sql).toContain("'ai_credits_exhausted'")
  })
})
