import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReportBarChart } from "@/components/reporting/report-bar-chart"

const chart = (
  <ReportBarChart
    title="Reviews received and replied"
    categoryHeading="Day"
    unitName="day"
    unitNote="Daily totals."
    data={[
      { label: "1 Sep", values: { reviews: 3, replies: 2 } },
      { label: "2 Sep", values: { reviews: 5, replies: null } },
      { label: "3 Sep", values: { reviews: 1, replies: 1 } },
    ]}
    series={[
      { key: "reviews", label: "Reviews", color: 1 },
      { key: "replies", label: "Replies", color: 2 },
    ]}
  />
)

function readout(container: HTMLElement) {
  return container.querySelector("[data-slot=report-bar-readout]")
}

describe("ReportBarChart tap to inspect", () => {
  it("shows the latest bar's figures before anything is picked", () => {
    const { container } = render(chart)
    expect(readout(container)).toHaveTextContent(
      "Latest day · 3 Sep: Reviews 1, Replies 1"
    )
  })

  it("shows a tapped bar's period and values above the plot", () => {
    const { container } = render(chart)
    const columns = container.querySelectorAll("[role=slider] > div")
    fireEvent.click(columns[1])
    expect(readout(container)).toHaveTextContent("2 Sep: Reviews 5, Replies —")
    expect(columns[1]).toHaveAttribute("data-selected", "true")
  })

  it("is one keyboard stop that steps through the bars", () => {
    render(chart)
    const slider = screen.getByRole("slider", {
      name: "Reviews received and replied: pick a day",
    })
    expect(slider).toHaveAttribute("tabindex", "0")
    expect(slider).toHaveAttribute("aria-valuenow", "2")
    expect(slider).toHaveAttribute("aria-valuetext", "3 Sep: Reviews 1, Replies 1")
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(slider).toHaveAttribute("aria-valuetext", "2 Sep: Reviews 5, Replies —")
    fireEvent.keyDown(slider, { key: "Home" })
    expect(slider).toHaveAttribute("aria-valuenow", "0")
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(slider).toHaveAttribute("aria-valuenow", "0")
    fireEvent.keyDown(slider, { key: "End" })
    expect(slider).toHaveAttribute("aria-valuenow", "2")
    // No bar is a tab stop of its own.
    expect(slider.querySelectorAll("[tabindex]")).toHaveLength(0)
  })

  it("keeps every value in the screen-reader table", () => {
    render(chart)
    const table = screen.getByRole("table", {
      name: "Reviews received and replied",
    })
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect(within(table).getByText("5")).toBeInTheDocument()
  })

  it("is not a scroll stop while the plot fits", () => {
    const { container } = render(chart)
    // jsdom lays nothing out, so the plot never overflows.
    expect(container.querySelector("[aria-label$='scrolls sideways']")).toBeNull()
  })
})
