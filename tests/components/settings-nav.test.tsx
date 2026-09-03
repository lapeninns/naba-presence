import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SettingsNav } from "@/components/settings/settings-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/connections" }))

describe("SettingsNav", () => {
  it("shows every area to an owner and marks the active one", () => {
    render(<SettingsNav role="owner" />)
    const nav = screen.getByRole("navigation", { name: "Settings sections" })
    for (const label of ["Policy", "Compliance", "Connections", "Operations"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Connections" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(nav).toBeInTheDocument()
  })

  it("no longer hides Team and Listing inside Settings", () => {
    // Team became a primary destination; Listing administered a location from
    // a page nowhere near it and moved into that location's Access section.
    render(<SettingsNav role="owner" />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Listing" })).not.toBeInTheDocument()
  })

  it("shows every area to an admin too (admins can view Compliance)", () => {
    render(<SettingsNav role="admin" />)
    for (const label of ["Policy", "Compliance", "Connections", "Operations"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("shows a member only the Policy area", () => {
    render(<SettingsNav role="member" />)
    expect(screen.getByRole("link", { name: "Policy" })).toBeInTheDocument()
    for (const gone of ["Compliance", "Connections", "Operations"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
