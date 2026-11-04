import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import SettingsLoading from "@/app/(dashboard)/settings/loading"

describe("settings loading", () => {
  it("is one busy status that names what is loading and claims nothing else", () => {
    render(<SettingsLoading />)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent(/^Loading settings$/)
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("draws no tab row: the layout's real section list stays beside it", () => {
    const { container } = render(<SettingsLoading />)
    expect(container.querySelector(".border-b")).toBeNull()
    expect(container.querySelector(".max-md\\:hidden")).toBeNull()
    expect(
      container.querySelector("[data-slot='settings-loading-header']")
    ).not.toBeNull()
  })

  it("draws flat bars that pulse only when motion is welcome", () => {
    const { container } = render(<SettingsLoading />)
    const bars = container.querySelectorAll("[data-slot='skeleton']")
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(bar.className).not.toMatch(/(^|\s)animate-/)
    }
  })
})
