import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"

describe("FetchedAtCaption", () => {
  it("does not report an absence while the query is still in flight", () => {
    // `overview?.to ?? null` is null before the response lands, and this used
    // to render "No data yet — nothing to show" for it: a claim about Google
    // made before anyone had looked.
    render(<FetchedAtCaption iso={null} timezone="UTC" pending />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading…")
    expect(screen.queryByText(/nothing to show/i)).toBeNull()
  })

  it("reports the absence once the answer is in", () => {
    render(<FetchedAtCaption iso={null} timezone="UTC" />)
    expect(screen.getByText("Nothing collected yet")).toBeInTheDocument()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("dates the figures when it has a date", () => {
    render(<FetchedAtCaption iso="2026-09-01T00:00:00.000Z" timezone="UTC" />)
    expect(screen.getByText(/^As at /)).toBeInTheDocument()
  })
})

describe("ReportingPanel", () => {
  it("does not render a spinner for a state that will never resolve on screen", () => {
    // The presence route's "pending" means Google has not sent figures yet —
    // the request itself already returned. Rendering it as `loading` left a
    // skeleton spinning until the operator reloaded, possibly days later.
    render(<ReportingPanel variant="collecting" />)
    expect(screen.getByText("Nothing collected yet")).toBeInTheDocument()
    expect(
      screen.getByText(/Google has not sent any figures for this window/)
    ).toBeInTheDocument()
  })

  it("names a genuine in-flight load instead of showing bare bars", () => {
    render(<ReportingPanel variant="loading" title="Loading keywords…" />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading keywords…")
  })

  it("stays a plain skeleton when no caller named the wait", () => {
    render(<ReportingPanel variant="loading" />)
    expect(screen.queryByRole("status")).toBeNull()
  })
})
