import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChartDataTable, ChartLegend } from "@/components/ui/chart"

describe("ChartLegend", () => {
  it("labels each series and marks swatches decorative", () => {
    render(
      <ChartLegend
        items={[
          { label: "Reviews", colorVar: 1 },
          { label: "Replies", colorVar: 4 },
        ]}
      />
    )
    expect(screen.getByText("Reviews")).toBeInTheDocument()
    expect(screen.getByText("Replies")).toBeInTheDocument()
  })

  // A phone cannot hover, so the figure for the picked point has to be
  // readable in the legend itself.
  it("prints each series' value beside its name when given", () => {
    render(
      <ChartLegend
        items={[
          { label: "Reviews", colorVar: 1, value: "12" },
          { label: "Replies", colorVar: 4, value: 0 },
        ]}
      />
    )
    const items = screen.getAllByRole("listitem")
    expect(within(items[0]).getByText("12")).toBeInTheDocument()
    // Zero is a figure, not a missing value.
    expect(within(items[1]).getByText("0")).toBeInTheDocument()
  })
})

describe("ChartDataTable", () => {
  it("is a captioned table of the same figures, hidden until asked for", () => {
    const { rerender } = render(
      <ChartDataTable
        caption="Review volume"
        columns={["Week", "Reviews"]}
        rows={[["6 Oct", "12"]]}
      />
    )
    const table = screen.getByRole("table", { name: "Review volume" })
    expect(table).toHaveClass("sr-only")
    expect(screen.getByRole("rowheader", { name: "6 Oct" })).toBeInTheDocument()
    rerender(
      <ChartDataTable
        caption="Review volume"
        columns={["Week", "Reviews"]}
        rows={[["6 Oct", "12"]]}
        visible
      />
    )
    expect(screen.getByRole("table", { name: "Review volume" })).not.toHaveClass(
      "sr-only"
    )
  })
})
