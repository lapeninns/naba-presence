import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  ReplyFigures,
  seriesAgrees,
  type ReplySummaryFigures,
} from "@/components/reporting/reply-figures"

const SUMMARY: ReplySummaryFigures = {
  reviewVolume: 2,
  averageRating: 4.5,
  responseRate: 50,
  medianFirstResponseSeconds: 5400,
}
const PREVIOUS: ReplySummaryFigures = {
  reviewVolume: 0,
  averageRating: null,
  responseRate: null,
  medianFirstResponseSeconds: null,
}
const EMPTY_SERIES = [
  {
    period: "2026-10-04T11:00:00.000Z",
    reviewCount: 0,
    replies: 0,
    averageRating: null,
  },
  {
    period: "2026-10-05T11:00:00.000Z",
    reviewCount: 0,
    replies: 0,
    averageRating: null,
  },
]
const SERIES = [
  {
    period: "2026-10-04T11:00:00.000Z",
    reviewCount: 1,
    replies: 1,
    averageRating: 5,
  },
  {
    period: "2026-10-05T11:00:00.000Z",
    reviewCount: 1,
    replies: 0,
    averageRating: 4,
  },
]

const base = {
  timezone: "Pacific/Auckland",
  unit: "day" as const,
  rangeLabel: "Last 28 days",
  periodText: "15 Sept – 13 Oct",
}

describe("ReplyFigures", () => {
  it("draws two tiles to a row on a phone", () => {
    const { container } = render(
      <ReplyFigures
        audience="internal"
        summary={SUMMARY}
        previous={PREVIOUS}
        series={SERIES}
        {...base}
      />
    )
    // One strip around the four figures (group, don't box), its grid two to
    // a row below 48rem of its own width.
    const strip = container.querySelector("[data-slot=reply-tiles]")!
    expect(strip).toHaveAttribute("data-kpi-strip")
    expect(strip.querySelectorAll("[data-slot=kpi-tile]")).toHaveLength(4)
    expect(
      strip.querySelector("[data-slot=kpi-strip-grid]")?.className
    ).toContain("grid-cols-2")
  })

  it("shows missing figures as —, never 0, and no delta without both windows", () => {
    render(
      <ReplyFigures
        audience="internal"
        summary={{
          ...SUMMARY,
          responseRate: null,
          medianFirstResponseSeconds: null,
        }}
        previous={null}
        series={SERIES}
        {...base}
      />
    )
    expect(screen.getAllByText("—")).toHaveLength(2)
    expect(screen.queryByText(/previous period/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Changes compare/)).not.toBeInTheDocument()
  })

  it("reads a shorter response time as faster", () => {
    render(
      <ReplyFigures
        audience="internal"
        summary={SUMMARY}
        previous={{ ...SUMMARY, medianFirstResponseSeconds: 6600 }}
        series={SERIES}
        {...base}
      />
    )
    expect(
      screen.getByText(/faster than the previous period/)
    ).toBeInTheDocument()
    expect(
      screen.getByText("Changes compare with the 28 days before this period.")
    ).toBeInTheDocument()
  })

  it("never says no reviews beside tiles that count some", () => {
    // The series used to arrive all zeros after a clock change (fixed on the
    // server); the card must still not contradict the tiles.
    render(
      <ReplyFigures
        audience="internal"
        summary={SUMMARY}
        previous={PREVIOUS}
        series={EMPTY_SERIES}
        {...base}
      />
    )
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(
      screen.queryByText("No reviews in this period")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("No rated reviews in this period")
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText("Chart unavailable for this period")
    ).toHaveLength(2)
  })

  it("draws the charts with a value table when the series has reviews", () => {
    render(
      <ReplyFigures
        audience="internal"
        summary={SUMMARY}
        previous={PREVIOUS}
        series={SERIES}
        {...base}
      />
    )
    expect(
      screen.getByRole("table", { name: "Reviews received and replied" })
    ).toBeInTheDocument()
    // Buckets are labelled on the organisation's clock: 5 and 6 Oct in Auckland.
    expect(screen.getAllByText("6 Oct").length).toBeGreaterThan(0)
  })

  it("says no reviews when the window truly has none but the last one did", () => {
    render(
      <ReplyFigures
        audience="public"
        summary={PREVIOUS}
        previous={SUMMARY}
        series={EMPTY_SERIES}
        {...base}
      />
    )
    expect(screen.getByText("No reviews in this period")).toBeInTheDocument()
    expect(
      screen.getByText("No rated reviews in this period")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Chart unavailable/)).not.toBeInTheDocument()
  })

  it("collapses to one empty panel only once the previous window has answered", () => {
    const { rerender } = render(
      <ReplyFigures
        audience="internal"
        summary={PREVIOUS}
        previous="pending"
        series={EMPTY_SERIES}
        pending={<p>Waiting for the comparison</p>}
        {...base}
      />
    )
    expect(screen.getByText("Waiting for the comparison")).toBeInTheDocument()
    expect(screen.queryByText("Reviews")).not.toBeInTheDocument()
    rerender(
      <ReplyFigures
        audience="internal"
        summary={PREVIOUS}
        previous={PREVIOUS}
        series={EMPTY_SERIES}
        {...base}
      />
    )
    expect(
      screen.getByText("No reviews in this period yet")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /these listings in the last 28 days \(15 Sept – 13 Oct\)/
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("Response rate")).not.toBeInTheDocument()
  })

  it("words the empty state for the client on the public report", () => {
    render(
      <ReplyFigures
        audience="public"
        summary={PREVIOUS}
        previous={null}
        series={[]}
        {...base}
      />
    )
    expect(screen.getByText("No reviews in this period")).toBeInTheDocument()
    expect(
      screen.getByText(
        "No reviews arrived for these listings in the last 28 days."
      )
    ).toBeInTheDocument()
  })

  it("uses one hint for response rate whoever reads it", () => {
    for (const audience of ["internal", "public"] as const) {
      const { unmount } = render(
        <ReplyFigures
          audience={audience}
          summary={SUMMARY}
          previous={PREVIOUS}
          series={SERIES}
          {...base}
        />
      )
      expect(
        screen.getByText("Reviews with a reply posted to Google")
      ).toBeInTheDocument()
      unmount()
    }
  })

  it("draws no charts for a scope without a series", () => {
    render(
      <ReplyFigures
        audience="internal"
        summary={SUMMARY}
        previous={PREVIOUS}
        series={null}
        {...base}
      />
    )
    expect(
      screen.queryByRole("heading", { name: "Review volume" })
    ).not.toBeInTheDocument()
  })
})

describe("seriesAgrees", () => {
  it("is false only when the tiles count reviews the series does not", () => {
    expect(seriesAgrees({ reviewVolume: 2 }, EMPTY_SERIES)).toBe(false)
    expect(seriesAgrees({ reviewVolume: 2 }, SERIES)).toBe(true)
    expect(seriesAgrees({ reviewVolume: 0 }, EMPTY_SERIES)).toBe(true)
  })
})
