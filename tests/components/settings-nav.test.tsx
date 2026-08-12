import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SettingsNav } from "@/components/settings/settings-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/team" }))

describe("SettingsNav", () => {
  it("shows every area to an owner and marks the active one", () => {
    render(<SettingsNav role="owner" />)
    const nav = screen.getByRole("navigation", { name: "Settings sections" })
    for (const label of ["Policy", "Team", "Compliance", "Connections", "Operations", "Listing"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
  })

  it("shows every area to an admin too (admins can view Compliance)", () => {
    render(<SettingsNav role="admin" />)
    for (const label of ["Policy", "Team", "Compliance", "Connections", "Operations"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("shows a member only the Policy area", () => {
    render(<SettingsNav role="member" />)
    expect(screen.getByRole("link", { name: "Policy" })).toBeInTheDocument()
    for (const gone of ["Team", "Compliance", "Connections", "Operations"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
