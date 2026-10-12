import { render, screen } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UsageCard } from "@/components/settings/usage-card"
import type { AiCredits, AiCreditsDaily } from "@/lib/contracts/ai-credits"
import * as creditsHook from "@/lib/queries/use-ai-credits"

const BASE: AiCredits = {
  used: 12,
  allowance: 100,
  remaining: 88,
  periodId: "00000000-0000-4000-8000-0000000000e1",
  periodKind: "pilot_month",
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-11-01T00:00:00.000Z",
  canUseAi: true,
  accessReason: "pilot",
}

function mount(credits: Partial<AiCredits>) {
  vi.spyOn(creditsHook, "useAiCredits").mockReturnValue({
    data: { ...BASE, ...credits },
    isPending: false,
  } as UseQueryResult<AiCredits>)
  vi.spyOn(creditsHook, "useAiCreditsDaily").mockReturnValue({
    data: { days: [] },
  } as unknown as UseQueryResult<AiCreditsDaily>)
  render(<UsageCard />)
}

describe("UsageCard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows a pilot month's balance and its reset date", () => {
    mount({})
    expect(screen.getByText(/credits used this month/)).toBeVisible()
    expect(screen.getByText("Credits reset on 1 Nov.")).toBeVisible()
  })

  it("names a paid period and resets on the period row's end", () => {
    mount({
      periodKind: "paid_period",
      periodEnd: "2026-11-14T08:00:00.000Z",
    })
    expect(screen.getByText(/credits used this period/)).toBeVisible()
    expect(screen.getByText("Credits reset on 14 Nov.")).toBeVisible()
  })

  it("says an unknown allowance in words instead of showing zero", () => {
    mount({
      allowance: null,
      remaining: null,
      periodId: null,
      periodKind: null,
      periodStart: null,
      periodEnd: null,
    })
    expect(screen.getByText(/allowance is not confirmed yet/)).toBeVisible()
    expect(screen.queryByText(/credits used/)).not.toBeInTheDocument()
  })

  it("says when an exhausted period's credits come back", () => {
    mount({
      used: 100,
      remaining: 0,
      periodKind: "paid_period",
      periodEnd: "2026-11-14T08:00:00.000Z",
    })
    expect(screen.getByText(/100 of 100/)).toBeVisible()
    expect(
      screen.getByText(
        "Out of AI credits until 14 Nov. You can still write a reply yourself."
      )
    ).toBeVisible()
    expect(screen.queryByText(/Credits reset on/)).not.toBeInTheDocument()
  })

  it("says AI drafting is off while billing is read-only, not a zero balance", () => {
    mount({ canUseAi: false, accessReason: "grace_expired", used: 3 })
    expect(screen.getByText(/subscription is read-only/)).toBeVisible()
    expect(screen.queryByText(/credits used/)).not.toBeInTheDocument()
  })
})
