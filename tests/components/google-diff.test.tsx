import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GoogleDiff } from "@/components/locations/google-diff"

describe("GoogleDiff", () => {
  it("shows current-Google vs your-edit for each touched field, em dash for null", () => {
    render(<GoogleDiff rows={[{ key: "title", label: "Business name", currentValue: "Old", nextValue: "New" }, { key: "website", label: "Website", currentValue: null, nextValue: "https://x.test" }]} />)
    expect(screen.getByText("Old")).toBeInTheDocument()
    expect(screen.getByText("New")).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
