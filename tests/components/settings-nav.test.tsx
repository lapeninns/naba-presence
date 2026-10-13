import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillingScreensProvider } from "@/components/settings/billing-screens"
import { SettingsFeaturesProvider } from "@/components/settings/settings-features"
import { SettingsIndex } from "@/components/settings/settings-index"
import { SettingsNav } from "@/components/settings/settings-nav"

let pathname = "/settings/connections"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

afterEach(() => {
  pathname = "/settings/connections"
  vi.restoreAllMocks()
})

function tabs() {
  return screen.getByRole("navigation", { name: "Settings sections" })
}

describe("SettingsNav", () => {
  it("shows every area to an owner and marks the active one", () => {
    render(<SettingsNav role="owner" />)
    for (const label of ["Reply policy", "Google connections"]) {
      expect(
        within(tabs()).getByRole("link", { name: label })
      ).toBeInTheDocument()
    }
    expect(
      within(tabs()).getByRole("link", { name: "Google connections" })
    ).toHaveAttribute("aria-current", "page")
  })

  it("names each area once, the same as its page's h1", () => {
    // settings-setup-auth-m4: the tab says "Reply policy", as the page does.
    render(<SettingsNav role="owner" />)
    expect(
      within(tabs()).getByRole("link", { name: "Reply policy" })
    ).toHaveAttribute("href", "/settings/policy")
    expect(
      within(tabs()).queryByRole("link", { name: "Policy" })
    ).not.toBeInTheDocument()
  })

  it("marks Reply policy current at both its addresses", () => {
    for (const path of ["/settings", "/settings/policy"]) {
      pathname = path
      render(<SettingsNav role="viewer" />)
      expect(
        within(tabs()).getByRole("link", { name: "Reply policy" })
      ).toHaveAttribute("aria-current", "page")
      cleanup()
    }
  })

  it("scrolls the current tab into view, moving the row only as far as needed", () => {
    // settings-setup-auth-02: every page re-mounts the row, which used to
    // open scrolled to its start with the current tab off-screen.
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    render(<SettingsNav role="owner" />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    })
    expect(scrollIntoView.mock.contexts[0]).toHaveTextContent(
      "Google connections"
    )
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView
  })

  it("leads a phone back to the settings index instead of a tab row", () => {
    render(<SettingsNav role="owner" />)
    expect(screen.getByRole("link", { name: "All settings" })).toHaveAttribute(
      "href",
      "/settings"
    )
    // Below md the tab row is hidden in CSS; the index is the way round.
    expect(tabs()).toHaveClass("max-md:hidden")
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
    for (const label of ["Reply policy", "Google connections"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("shows a member Reply policy and Notifications, nothing managerial", () => {
    render(<SettingsNav role="member" />)
    expect(
      screen.getByRole("link", { name: "Reply policy" })
    ).toBeInTheDocument()
    for (const gone of [
      "Google connections",
      "Operations",
      "Data and privacy",
    ]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })

  it("shows Sign-in security to every role only while MFA is on", () => {
    render(<SettingsNav role="viewer" />)
    expect(
      screen.queryByRole("link", { name: "Sign-in security" })
    ).not.toBeInTheDocument()
    cleanup()
    render(
      <SettingsFeaturesProvider value={{ mfa: true }}>
        <SettingsNav role="viewer" />
      </SettingsFeaturesProvider>
    )
    expect(
      screen.getByRole("link", { name: "Sign-in security" })
    ).toHaveAttribute("href", "/settings/security")
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

describe("SettingsIndex", () => {
  function group(name: string) {
    return screen.getByRole("list", { name })
  }

  it("groups a viewer's areas into You and Workspace, with the policy marked view only", () => {
    // settings-setup-auth-03: a viewer's settings home is a list of what
    // they may open, not a read-only form.
    render(
      <SettingsFeaturesProvider value={{ mfa: true }}>
        <SettingsIndex role="viewer" />
      </SettingsFeaturesProvider>
    )
    const index = screen.getByRole("navigation", { name: "Settings" })
    expect(within(index).getAllByRole("list")).toHaveLength(2)
    const you = group("You")
    expect(
      within(you).getByRole("link", { name: /Notifications/ })
    ).toHaveAttribute("href", "/settings/notifications")
    expect(
      within(you).getByRole("link", { name: /Sign-in security/ })
    ).toBeInTheDocument()
    const policy = within(group("Workspace")).getByRole("link", {
      name: /Reply policy/,
    })
    expect(policy).toHaveAttribute("href", "/settings/policy")
    expect(policy).toHaveTextContent("View only")
    for (const gone of [
      /Team/,
      /Google connections/,
      /Operations/,
      /Data and privacy/,
      /Billing/,
    ]) {
      expect(
        within(index).queryByRole("link", { name: gone })
      ).not.toBeInTheDocument()
    }
  })

  it("offers an owner Team on the index (never as a tab), and an editable policy", () => {
    render(
      <BillingScreensProvider enabled>
        <SettingsIndex role="owner" />
      </BillingScreensProvider>
    )
    const workspace = group("Workspace")
    expect(
      within(workspace).getByRole("link", { name: /Team/ })
    ).toHaveAttribute("href", "/team")
    expect(
      within(workspace).getByRole("link", { name: /Reply policy/ })
    ).not.toHaveTextContent("View only")
    for (const name of [
      /Google connections/,
      /Operations/,
      /Usage/,
      /Billing/,
    ]) {
      expect(within(workspace).getByRole("link", { name })).toBeInTheDocument()
    }
  })
})
