import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SectionPanel } from "@/components/locations/section-panel"

describe("SectionPanel ({ data, error } honesty)", () => {
  it("shows honest generic copy on error and never the raw Google message", () => {
    render(
      <SectionPanel title="Business calls" result={{ data: null, error: "Google 500: quota exceeded on projects/123" }}>
        {() => <div>should not render</div>}
      </SectionPanel>
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText(/quota exceeded|projects\/123|Google 500/)).not.toBeInTheDocument()
    expect(screen.queryByText("should not render")).not.toBeInTheDocument()
  })
  it("renders children with the data when present", () => {
    render(
      <SectionPanel title="Business calls" result={{ data: { callsState: "ENABLED" }, error: null }}>
        {(data) => <div>calls: {(data as { callsState: string }).callsState}</div>}
      </SectionPanel>
    )
    expect(screen.getByText("calls: ENABLED")).toBeInTheDocument()
  })
})
