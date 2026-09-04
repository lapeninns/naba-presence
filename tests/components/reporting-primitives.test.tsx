import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DeltaBadge } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { nullableCell, ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"

describe("StatTile", () => {
  it("renders label, value, and an optional hint", () => {
    render(<StatTile label="Average rating" value="4.4" hint="Across 42 reviews" />)
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("4.4")).toBeInTheDocument()
    expect(screen.getByText("Across 42 reviews")).toBeInTheDocument()
  })
})

describe("DeltaBadge (non-colour cue)", () => {
  it("shows a signed magnitude with a direction glyph, and an accessible label", () => {
    render(<DeltaBadge current={120} previous={100} unit="count" />)
    const badge = screen.getByText(/\+20/)
    expect(badge).toBeInTheDocument()
    // Direction is conveyed by an arrow glyph in the text, not colour alone.
    expect(badge.textContent).toMatch(/[▲▼]|↑|↓/)
    expect(screen.getByLabelText(/up|increase|higher/i)).toBeInTheDocument()
  })
  it("renders a duration delta as faster/slower, never raw seconds", () => {
    render(<DeltaBadge current={5400} previous={6600} unit="duration" />)
    expect(screen.getByText(/−20m/)).toBeInTheDocument()
    expect(screen.getByLabelText(/faster/i)).toBeInTheDocument()
  })
  it("renders nothing when the comparison is undefined", () => {
    const { container } = render(<DeltaBadge current={5} previous={null} />)
    expect(container).toBeEmptyDOMElement()
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
