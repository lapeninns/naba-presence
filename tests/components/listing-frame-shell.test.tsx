import { render, screen } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => "hours",
  usePathname: () => "/listings/l1/hours",
}))
vi.mock("@/components/listings/listing-gate", () => ({
  ListingGate: ({
    children,
  }: {
    children: (entry: unknown) => React.ReactNode
  }) => children({ id: "l1", name: "Riverside", clientId: null, linked: true }),
}))
vi.mock("@/components/editors/activity-drawer", () => ({
  ActivityDrawer: () => null,
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({ data: [] }),
}))
vi.mock("@/lib/queries/use-listing-summary", () => ({
  useListingSummary: () => ({ data: undefined, isError: true }),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => ({ data: undefined }),
}))

import {
  freshnessIsStale,
  GoogleFreshness,
  GoogleFreshnessLine,
} from "@/components/editors/google-freshness"
import {
  useReportEditorStatus,
  type EditorStatusReport,
} from "@/components/editors/editor-status"
import { AreaFrame } from "@/components/listings/area-frame"
import { fitTabs } from "@/components/ui/tabs"
import { renderWithProviders } from "../helpers/render"

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function Editor({
  report,
  observedAt,
}: {
  report: EditorStatusReport
  observedAt?: string
}) {
  useReportEditorStatus(report)
  return (
    <GoogleFreshness
      observedAt={observedAt}
      onRefresh={() => {}}
      refreshing={false}
    />
  )
}

const clean: EditorStatusReport = {
  status: "in_sync",
  isDirty: false,
  localEdits: false,
  savesHere: true,
}

function frame(report: EditorStatusReport, observedAt?: string) {
  return renderWithProviders(
    <AreaFrame locationId="l1" role="owner" area="hours">
      <Editor report={report} observedAt={observedAt} />
    </AreaFrame>
  )
}

const pill = () =>
  document.querySelector('[data-slot="area-editor-status"]') as HTMLElement

describe("the area header's status pill", () => {
  it("reports unsaved changes in the lifecycle words, with their glyph", () => {
    frame({ ...clean, status: "edited", isDirty: true, localEdits: true })
    expect(pill()).toHaveTextContent("Unsaved changes")
    expect(pill()).toHaveAttribute("data-state", "unsaved")
    expect(pill()).toHaveAttribute("data-tone", "neutral")
    expect(pill().querySelector('[data-glyph="circle-dashed"]')).not.toBeNull()
  })

  it("reports a draft saved here, never as sent or on Google", () => {
    frame({ ...clean, status: "unpublished", isDirty: true })
    expect(pill()).toHaveTextContent("Draft saved")
    expect(pill()).toHaveAttribute("data-state", "saved_locally")
    expect(pill()).not.toHaveTextContent(/published|On Google/)
  })

  it("claims in sync only while the editor's look at Google is current", () => {
    const { unmount } = frame(clean, ago(60_000))
    expect(pill()).toHaveTextContent("In sync")
    unmount()
    frame(clean, ago(3 * 60 * 60_000))
    // Three hours old: the pill steps back rather than vouch for it.
    expect(pill()).toBeNull()
    expect(
      document.querySelector('[data-slot="google-freshness"][data-stale]')
    ).not.toBeNull()
  })
})

describe("the editor's Google freshness line", () => {
  const report = (observedAt: string) => ({
    observedAt,
    refreshing: false,
    failed: false,
    disabled: false,
    refresh: () => {},
  })

  it("says when it last checked, plainly, while current", () => {
    render(<GoogleFreshnessLine report={report(ago(60_000))} />)
    expect(screen.getByText(/^Checked with Google/)).toBeInTheDocument()
    expect(
      document.querySelector('[data-slot="google-freshness"]')
    ).not.toHaveAttribute("data-stale")
  })

  it("says Google may have changed once the check is over an hour old", () => {
    render(<GoogleFreshnessLine report={report(ago(2 * 60 * 60_000))} />)
    const line = document.querySelector('[data-slot="google-freshness"]')
    expect(line).toHaveAttribute("data-stale")
    expect(line).toHaveTextContent(/Last checked with Google .* ago/)
    expect(line).toHaveTextContent("Google may have changed since.")
    // Check Google now is a read: a link button, never the send fill.
    expect(
      screen.getByRole("button", { name: "Check Google now" })
    ).toHaveAttribute("data-variant", "link")
  })

  it("treats an unreadable time as stale", () => {
    expect(freshnessIsStale({ observedAt: "nope" }, Date.now())).toBe(true)
    expect(freshnessIsStale(null, Date.now())).toBe(false)
  })
})

describe("the desk tab row's cap", () => {
  const layout = (count: number, available = 2000) => ({
    widths: Array.from({ length: count }, () => 100),
    gap: 4,
    more: 80,
    available,
  })

  it("shows every tab when they fit and are within the cap", () => {
    expect(fitTabs(layout(6), -1, 6)).toEqual(Array(6).fill(true))
    expect(fitTabs(layout(10), -1)).toEqual(Array(10).fill(true))
  })

  it("keeps at most the cap in the row, even with room for more", () => {
    const shown = fitTabs(layout(11), -1, 6)
    expect(shown.filter(Boolean)).toHaveLength(6)
    expect(shown.slice(0, 6)).toEqual(Array(6).fill(true))
  })

  it("keeps the current tab inside the cap", () => {
    const shown = fitTabs(layout(11), 8, 6)
    expect(shown[8]).toBe(true)
    expect(shown.filter(Boolean)).toHaveLength(6)
    expect(shown[5]).toBe(false)
  })

  it("leaves an unmeasured row whole", () => {
    expect(fitTabs(layout(11, 0), -1, 6)).toEqual(Array(11).fill(true))
  })
})
