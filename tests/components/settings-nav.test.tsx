import { cleanup, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BillingScreensProvider } from "@/components/settings/billing-screens"
import { SettingsNav } from "@/components/settings/settings-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/connections",
}))

describe("SettingsNav", () => {
  it("shows every area to an owner and marks the active one", () => {
    render(<SettingsNav role="owner" />)
    const nav = screen.getByRole("navigation", { name: "Settings sections" })
    for (const label of ["Policy", "Google connections"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(
      screen.getByRole("link", { name: "Google connections" })
    ).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
  })

  it("no longer hides Team and Listing inside Settings", () => {
    // Team became a primary destination; Listing administered a location from
    // a page nowhere near it and moved into that location's Access section.
    render(<SettingsNav role="owner" />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Listing" })
    ).not.toBeInTheDocument()
  })

  it("offers Operations to owners and admins only, and no Compliance console", () => {
    // Data-subject requests and legal holds are served by their gated API
    // routes. Operations returned as the owner/admin recovery view the GBP
    // operations brief requires (WP8).
    render(<SettingsNav role="owner" />)
    expect(
      screen.queryByRole("link", { name: "Compliance" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Operations" })).toBeInTheDocument()
    cleanup()
    render(<SettingsNav role="member" />)
    expect(
      screen.queryByRole("link", { name: "Operations" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Notifications" })
    ).toBeInTheDocument()
  })

  it("shows every area to an admin too", () => {
    render(<SettingsNav role="admin" />)
    for (const label of ["Policy", "Google connections"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("shows a member only the Policy area", () => {
    render(<SettingsNav role="member" />)
    expect(screen.getByRole("link", { name: "Policy" })).toBeInTheDocument()
    for (const gone of ["Google connections"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })

  it("adds Usage for everyone and Billing for the owner only while billing is on", () => {
    render(<SettingsNav role="owner" />)
    expect(
      screen.queryByRole("link", { name: "Billing" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Usage" })
    ).not.toBeInTheDocument()
    cleanup()
    render(
      <BillingScreensProvider enabled>
        <SettingsNav role="owner" />
      </BillingScreensProvider>
    )
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/settings/billing"
    )
    expect(screen.getByRole("link", { name: "Usage" })).toBeInTheDocument()
    for (const role of ["admin", "member", "viewer"]) {
      cleanup()
      render(
        <BillingScreensProvider enabled>
          <SettingsNav role={role} />
        </BillingScreensProvider>
      )
      expect(
        screen.queryByRole("link", { name: "Billing" })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Usage" })).toBeInTheDocument()
    }
  })
})
