import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import {
  replyLocationsCsv,
  ReplyLocationsTable,
} from "@/components/performance/reply-locations-table"
import { ReportBarChart } from "@/components/reporting/report-bar-chart"
import type { AnalyticsLocation } from "@/lib/api/analytics"

afterEach(() => vi.restoreAllMocks())

describe("ReportBarChart values", () => {
  const chart = (
    <ReportBarChart
      title="Reviews received and replied"
      categoryHeading="Day"
      unitName="day"
      unitNote="Daily totals."
      data={[
        { label: "1 Sep", values: { reviews: 3, replies: 2 } },
        { label: "2 Sep", values: { reviews: 5, replies: null } },
      ]}
      series={[
        { key: "reviews", label: "Reviews", color: 1 },
        { key: "replies", label: "Replies", color: 2 },
      ]}
    />
  )

  it("puts every value on screen on request, not only on hover", () => {
    // A bar's native tooltip never showed on a phone or to a keyboard.
    render(chart)
    const toggle = screen.getByRole("button", { name: "Show values" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(screen.getByRole("button", { name: "Hide values" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    const table = screen.getByRole("table", {
      name: "Reviews received and replied",
    })
    expect(table.className).not.toContain("sr-only")
    expect(within(table).getByText("5")).toBeInTheDocument()
  })

  it("downloads the series as CSV", () => {
    // jsdom has no object URLs; lend them for this test only.
    const create = vi.fn(() => "blob:chart")
    const saved = {
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    }
    URL.createObjectURL = create
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    try {
      render(chart)
      fireEvent.click(
        screen.getByRole("button", {
          name: "Download Reviews received and replied as CSV",
        })
      )
      expect(create).toHaveBeenCalled()
      expect(click).toHaveBeenCalled()
    } finally {
      URL.createObjectURL = saved.create
      URL.revokeObjectURL = saved.revoke
    }
  })
})

describe("ReplyLocationsTable", () => {
  const location = (overrides: Partial<AnalyticsLocation>) =>
    ({
      id: "l1",
      name: "Old Crown Girton",
      reviews: 10,
      averageRating: 4.2,
      responseRate: 0.9,
      medianFirstResponseSeconds: 3600,
      unresolvedComplaints: 2,
      ...overrides,
    }) as AnalyticsLocation

  it("opens a location's unresolved reviews from its count", () => {
    render(<ReplyLocationsTable locations={[location({})]} />)
    expect(
      screen.getByRole("link", {
        name: "2 unresolved at Old Crown Girton, open in the inbox",
      })
    ).toHaveAttribute("href", "/inbox?locationId=l1&rating=1,2")
    // The location link can be seen when it has focus.
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" }).className
    ).toContain("focus-halo")
  })

  it("exports raw figures, blanks for missing ones", () => {
    const rows = replyLocationsCsv([location({ averageRating: null })])
    expect(rows[1]).toEqual(["Old Crown Girton", 10, null, 0.9, 3600, 2])
  })
})
