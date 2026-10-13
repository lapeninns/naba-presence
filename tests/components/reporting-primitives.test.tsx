import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { kpiDelta } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { nullableCell, ReportingPanel } from "@/components/reporting/reporting-states"

describe("kpiDelta", () => {
  it("shapes a signed movement with its direction and a success tone for a rise", () => {
    expect(kpiDelta(120, 100, "count")).toMatchObject({
      value: expect.stringMatching(/\+20/),
      direction: "up",
      tone: "success",
    })
  })
  it("reads a shorter duration as faster, never raw seconds", () => {
    const delta = kpiDelta(5400, 6600, "duration")
    expect(delta).toMatchObject({ direction: "down", tone: "success" })
    expect(String(delta?.value)).toMatch(/−20m/)
    expect(String(delta?.label)).toMatch(/faster/)
  })
  it("is undefined when either window is missing", () => {
    expect(kpiDelta(5, null)).toBeUndefined()
    expect(kpiDelta(null, 5)).toBeUndefined()
  })
})

describe("FetchedAtCaption", () => {
  it("captions with a formatted date, and a fallback when null", () => {
    render(<FetchedAtCaption iso="2026-08-01T00:00:00.000Z" timezone="Europe/London" />)
    expect(screen.getByText(/As at/i)).toBeInTheDocument()
    render(<FetchedAtCaption iso={null} timezone="Europe/London" />)
    expect(screen.getByText("Nothing collected yet")).toBeInTheDocument()
  })
})

describe("nullableCell honest-null helper", () => {
  it("marks null as null and formats non-null", () => {
    expect(nullableCell(null, (v) => String(v))).toEqual({ text: "—", isNull: true })
    expect(nullableCell(3, (v) => `${v} pts`)).toEqual({ text: "3 pts", isNull: false })
  })
})

describe("ReportingPanel", () => {
  it("renders a distinct, honest message per variant with a retry only on error", () => {
    const { rerender } = render(<ReportingPanel variant="empty" description="No data yet." />)
    expect(screen.getByText("No data yet.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument()
    rerender(<ReportingPanel variant="error" onRetry={() => {}} />)
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
    rerender(<ReportingPanel variant="paused" />)
    expect(screen.getByText(/paused/i)).toBeInTheDocument()
    rerender(<ReportingPanel variant="off" />)
    expect(screen.getByText(/not switched on|turned on|not enabled|off/i)).toBeInTheDocument()
  })
})
