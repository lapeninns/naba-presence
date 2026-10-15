import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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

/** Lays the plot out as a 300px box starting at x = 100 (jsdom has no layout). */
function layOut(slider: HTMLElement) {
  slider.getBoundingClientRect = () =>
    ({
      left: 100,
      width: 300,
      right: 400,
      top: 0,
      bottom: 0,
      height: 0,
    }) as DOMRect
}

describe("ReportBarChart scrub to inspect", () => {
  it("shows the latest bar's figures before anything is picked", () => {
    const { container } = render(chart)
    expect(readout(container)).toHaveTextContent(
      "Latest day · 3 Sep: Reviews 1, Replies 1"
    )
  })

  it("shows the figures of the column under a touch, anywhere across its width", () => {
    const { container } = render(chart)
    const slider = screen.getByRole("slider")
    layOut(slider)
    const columns = container.querySelectorAll("[role=slider] > div")
    // Three columns across 300px: the middle one is x 200-300.
    fireEvent.pointerDown(slider, { pointerType: "touch", clientX: 290 })
    expect(readout(container)).toHaveTextContent("2 Sep: Reviews 5, Replies —")
    expect(columns[1]).toHaveAttribute("data-selected", "true")
  })

  it("follows a drag across the plot, and a mouse that only hovers", () => {
    const { container } = render(chart)
    const slider = screen.getByRole("slider")
    layOut(slider)
    // A touch that has not gone down does not move the readout.
    fireEvent.pointerMove(slider, { pointerType: "touch", clientX: 110 })
    expect(readout(container)).toHaveTextContent("Latest day")
    fireEvent.pointerDown(slider, { pointerType: "touch", clientX: 390 })
    fireEvent.pointerMove(slider, { pointerType: "touch", clientX: 110 })
    expect(readout(container)).toHaveTextContent("1 Sep: Reviews 3, Replies 2")
    fireEvent.pointerUp(slider, { pointerType: "touch" })
    fireEvent.pointerMove(slider, { pointerType: "touch", clientX: 390 })
    expect(readout(container)).toHaveTextContent("1 Sep")
    fireEvent.pointerMove(slider, { pointerType: "mouse", clientX: 250 })
    expect(readout(container)).toHaveTextContent("2 Sep: Reviews 5, Replies —")
  })

  it("is one keyboard stop that steps through the bars", () => {
    render(chart)
    const slider = screen.getByRole("slider", {
      name: "Reviews received and replied: pick a day",
    })
    expect(slider).toHaveAttribute("tabindex", "0")
    expect(slider).toHaveAttribute("aria-valuenow", "2")
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "3 Sep: Reviews 1, Replies 1"
    )
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "2 Sep: Reviews 5, Replies —"
    )
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
    expect(
      container.querySelector("[aria-label$='scrolls sideways']")
    ).toBeNull()
  })
})

const days = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    label: `${index + 1} Oct`,
    values: { reviews: index === 9 ? 6 : index === count - 1 ? 0 : 1 },
  }))

describe("ReportBarChart labels", () => {
  it("dates the busiest and the latest bar, apart from each other", () => {
    const { container } = render(
      <ReportBarChart
        title="Reviews"
        categoryHeading="Day"
        unitName="day"
        unitNote="Daily totals."
        data={days(20)}
        series={[{ key: "reviews", label: "Reviews", color: 1 }]}
      />
    )
    const slider = container.querySelector("[role=slider]")!
    expect(
      within(slider as HTMLElement).getByText("6 on 10 Oct")
    ).toBeInTheDocument()
    expect(
      within(slider as HTMLElement).getByText("0 on 20 Oct")
    ).toBeInTheDocument()
  })

  it("leaves the latest to the readout when it would sit on the busiest label", () => {
    const data = days(14)
    data[12] = { label: "13 Oct", values: { reviews: 9 } }
    const { container } = render(
      <ReportBarChart
        title="Reviews"
        categoryHeading="Day"
        unitName="day"
        unitNote="Daily totals."
        data={data}
        series={[{ key: "reviews", label: "Reviews", color: 1 }]}
      />
    )
    const slider = container.querySelector("[role=slider]") as HTMLElement
    expect(within(slider).getByText("9 on 13 Oct")).toBeInTheDocument()
    expect(within(slider).queryByText(/on 14 Oct/)).toBeNull()
    expect(
      container.querySelector("[data-slot=report-bar-readout]")
    ).toHaveTextContent("Latest day · 14 Oct: Reviews 0")
  })
})

describe("ReportBarChart on a narrow screen", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  })

  function narrow(width: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    )
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    })
  }

  const renderDays = (count: number, extra = {}) =>
    render(
      <ReportBarChart
        title="Reviews"
        categoryHeading="Day"
        unitName="day"
        unitNote="Daily totals."
        data={days(count)}
        series={[{ key: "reviews", label: "Reviews", color: 1 }]}
        {...extra}
      />
    )

  it("draws 28 days a week at a time, summed, and keeps every day in the table", () => {
    narrow(320)
    const { container } = renderDays(28)
    const slider = screen.getByRole("slider", { name: "Reviews: pick a week" })
    expect(slider).toHaveAttribute("aria-valuemax", "3")
    // The newest week is the last seven days (22-28 Oct): six ones and a 0.
    expect(
      container.querySelector("[data-slot=report-bar-readout]")
    ).toHaveTextContent("Latest week · 22 Oct – 28 Oct: Reviews 6")
    // The first week is seven ones; the busy day (10 Oct) is in the second.
    fireEvent.keyDown(slider, { key: "Home" })
    expect(slider).toHaveAttribute("aria-valuetext", "1 Oct – 7 Oct: Reviews 7")
    const table = screen.getByRole("table", { name: "Reviews" })
    expect(within(table).getAllByRole("row")).toHaveLength(29)
    expect(
      screen.getByText(/the table and CSV have every day/)
    ).toBeInTheDocument()
  })

  it("keeps a daily chart that fits, and one that cannot be added up", () => {
    narrow(900)
    renderDays(28)
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "27")
  })

  it("never groups a series that cannot be added up", () => {
    narrow(320)
    renderDays(28, { groupable: false })
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "27")
  })
})

describe("ReportBarChart as a line", () => {
  it("draws dots joined by a line for the days that have a value", () => {
    const { container } = render(
      <ReportBarChart
        title="Average rating"
        categoryHeading="Day"
        unitName="day"
        unitNote="Averages."
        kind="line"
        max={5}
        format={(value) => value.toFixed(1)}
        data={[
          { label: "1 Sep", values: { rating: 4.5 } },
          { label: "2 Sep", values: { rating: null } },
          { label: "3 Sep", values: { rating: 5 } },
        ]}
        series={[{ key: "rating", label: "Average rating", color: 1 }]}
      />
    )
    const points = container
      .querySelector("polyline")!
      .getAttribute("points")!
      .split(" ")
      .map((point) => point.split(",").map(Number))
    // 4.5 and 5 on a 0-5 scale, at the first and last of three columns.
    expect(points).toHaveLength(2)
    expect(points[0][0]).toBeCloseTo(16.67, 1)
    expect(points[0][1]).toBeCloseTo(10, 5)
    expect(points[1][0]).toBeCloseTo(83.33, 1)
    expect(points[1][1]).toBeCloseTo(0, 5)
    // Dots for the two rated days only; no bars.
    expect(
      container.querySelectorAll("[role=slider] .rounded-full")
    ).toHaveLength(2)
    expect(
      screen.getByText(/Each dot is a day with a rating/)
    ).toBeInTheDocument()
    const slider = screen.getByRole("slider")
    fireEvent.keyDown(slider, { key: "ArrowLeft" })
    expect(slider).toHaveAttribute("aria-valuetext", "2 Sep: Average rating —")
  })
})
