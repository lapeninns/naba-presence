import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CountBadge } from "@/components/app-shell/count-badge"

describe("CountBadge", () => {
  it("is a decorative ink badge, not an accent one", () => {
    const { container } = render(<CountBadge count={7} slot="tab-count" />)
    const badge = container.querySelector("[data-slot='tab-count']")
    expect(badge).toHaveTextContent("7")
    expect(badge).toHaveAttribute("aria-hidden")
    // Chrome is ink: the green is for the action and "you are here".
    expect(badge).toHaveClass("bg-ink", "text-ink-inverse", "tabular-nums")
    expect(badge).toHaveClass("h-5", "min-w-5")
    expect(badge).not.toHaveClass("bg-primary")
  })

  it("caps the figure at 99+", () => {
    const { container } = render(<CountBadge count={140} slot="rail-count" />)
    expect(
      container.querySelector("[data-slot='rail-count']")
    ).toHaveTextContent("99+")
  })
})
