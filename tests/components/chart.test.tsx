import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChartCard, ChartLegend } from "@/components/ui/chart"

describe("ChartCard states", () => {
  it("shows a skeleton while loading and the empty label when empty", () => {
    const { rerender } = render(
      <ChartCard title="Review volume" state="loading">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("Review volume")).toBeInTheDocument()
    expect(screen.queryByText("chart")).not.toBeInTheDocument()
    rerender(
      <ChartCard title="Review volume" state="empty" emptyLabel="No reviews in this window.">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("No reviews in this window.")).toBeInTheDocument()
    rerender(
      <ChartCard title="Review volume" state="ready">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("chart")).toBeInTheDocument()
  })
})

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
})
