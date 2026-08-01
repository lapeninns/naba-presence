import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"

function Boom(): never {
  throw new Error("detail exploded")
}

afterEach(() => vi.restoreAllMocks())

describe("DetailErrorBoundary", () => {
  it("isolates a thrown detail pane and offers a retry without crashing the list", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <DetailErrorBoundary>
        <Boom />
      </DetailErrorBoundary>
    )
    expect(screen.getByText("This review could not be shown.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("renders children when nothing throws", () => {
    render(
      <DetailErrorBoundary>
        <p>All good</p>
      </DetailErrorBoundary>
    )
    expect(screen.getByText("All good")).toBeInTheDocument()
  })
})
