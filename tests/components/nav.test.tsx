import { render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/inbox" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { Nav, navItemsFor } from "@/components/app-shell/nav"

beforeEach(() => {
  pathname.current = "/inbox"
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The links the sidebar marks as the current page. */
function currentLinks() {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
}

describe("primary navigation", () => {
  it("packs the rail's tiles on a short window and hovers only with a fine pointer", () => {
    render(<Nav role="owner" />)
    for (const label of ["Inbox", "Settings"]) {
      const row = screen.getByRole("link", { name: label })
      // 48px tiles below 640px tall: still above the 44px touch floor.
      expect(row).toHaveClass("md:max-wide:short:min-h-12")
      expect(row).toHaveClass("hover-fine:hover:bg-fill")
      expect(row.className).not.toMatch(/(^|\s)hover:/)
    }
  })

  it("offers five destinations and a Workspace group, and no Home", () => {
    render(<Nav />)
    expect(navItemsFor("agency").map((item) => item.label)).toEqual([
      "Inbox",
      "Listings",
      "Clients",
      "Calendar",
      "Reports",
    ])
    for (const [label, href] of [
      ["Inbox", "/inbox"],
      ["Listings", "/listings"],
      ["Clients", "/clients"],
      ["Calendar", "/calendar"],
      ["Reports", "/reports"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument()
    // The rows Team and Settings sit in are labelled, not disclosed.
    expect(screen.queryByRole("button", { name: "More" })).toBeNull()
  })

  // P08-R5: Calendar is the scheduled publications, so it leaves the
  // navigation while the organisation's post_scheduling feature is off.
  it("leaves Calendar out when scheduling is off", () => {
    render(<Nav hideCalendar />)
    expect(screen.queryByRole("link", { name: "Calendar" })).toBeNull()
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument()
    expect(navItemsFor("business", true).map((item) => item.label)).toEqual([
      "Inbox",
      "Listings",
      "Reports",
    ])
  })

  it("carries the client in scope on Inbox, Listings and Reports", () => {
    pathname.current = "/team"
    render(<Nav scopeClientId="c2" />)
    for (const [label, href] of [
      ["Inbox", "/inbox?clientId=c2"],
      ["Listings", "/listings?clientId=c2"],
      ["Clients", "/clients"],
      ["Reports", "/reports?clientId=c2"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }
  })

  it("keeps the current-page mark on a scoped link", () => {
    pathname.current = "/reports"
    render(<Nav scopeClientId="c1" />)
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("lists Team and Settings in a Workspace group, always visible", () => {
    // The label is for the wide sidebar (`max-wide:hidden`): the 768-1180
    // rail lists the same rows as tiles, so the rows stay in the DOM.
    render(<Nav role="owner" />)
    expect(screen.queryByRole("button", { name: "More" })).toBeNull()
    const group = screen.getByRole("list", { name: "Workspace" })
    expect(screen.getByText("Workspace")).toHaveClass("max-wide:hidden")
    // Named by the visible label, which is not also read as content.
    expect(screen.getByText("Workspace")).toHaveAttribute("aria-hidden")
    for (const [label, href] of [
      ["Team", "/team"],
      ["Settings", "/settings"],
    ]) {
      expect(within(group).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }
    // The daily rows are not in the Workspace group.
    expect(
      within(group).queryByRole("link", { name: "Inbox" })
    ).not.toBeInTheDocument()
    // From 768px the toolbar's bell is Notifications' place.
    expect(
      screen.queryByRole("link", { name: "Notifications" })
    ).not.toBeInTheDocument()
  })

  it("hides Team while the role is still unknown", () => {
    render(<Nav />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
  })

  it("marks Settings as the current page on one of its sections", () => {
    pathname.current = "/settings/connections"
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(currentLinks()).toHaveLength(1)
  })

  it("marks the destination Setup lives under", () => {
    pathname.current = "/setup"
    const agency = render(<Nav />)
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(currentLinks()).toHaveLength(1)
    agency.unmount()
    render(<Nav mode="business" />)
    expect(screen.getByRole("link", { name: "Listings" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(currentLinks()).toHaveLength(1)
  })

  it("introduces no heading", () => {
    // `heading-order` and `page-has-heading-one` are pinned axe rules, and a
    // heading in the sidebar would sit above the page's own h1.
    const { container } = render(<Nav />)
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
  })

  it("marks exactly one item as the current page", () => {
    pathname.current = "/inbox"
    render(<Nav />)
    const active = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Inbox")
  })

  it("lights Listings, not Clients, inside a listing", () => {
    // A listing is reached from the board; the breadcrumb leads back there.
    pathname.current = "/listings/abc/photos"
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Listings" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Clients" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it.each([
    ["/listings/abc/hours", "Listings"],
    ["/settings/notifications", "Settings"],
    ["/settings", "Settings"],
    ["/clients/new", "Clients"],
    ["/team", "Team"],
  ])("marks exactly one row for %s", (path, name) => {
    pathname.current = path
    render(<Nav role="owner" />)
    const active = currentLinks()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName(name)
  })

  // Clients are no longer pinned beneath Clients (DIRECTION D8): the
  // sidebar's "Working on" scope menu lists them with their health. So a
  // client page marks Clients itself, in the sidebar and the rail alike.
  it.each(["/clients/c1", "/clients/c2/settings"])(
    "marks Clients on the client page %s",
    (path) => {
      pathname.current = path
      render(<Nav />)
      const active = currentLinks()
      expect(active).toHaveLength(1)
      expect(active[0]).toHaveAccessibleName("Clients")
    }
  )

  it("lists no clients beneath Clients", () => {
    render(<Nav />)
    const links = screen.getAllByRole("link")
    expect(
      links.filter((link) => link.getAttribute("href")?.startsWith("/clients/"))
    ).toHaveLength(0)
  })

  it("reports a chosen destination through onNavigate", async () => {
    const onNavigate = vi.fn()
    render(<Nav onNavigate={onNavigate} />)
    screen.getByRole("link", { name: "Inbox" }).click()
    expect(onNavigate).toHaveBeenCalled()
    screen.getByRole("link", { name: "Settings" }).click()
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it("shows the needs-reply count without renaming the Inbox link", () => {
    render(<Nav waiting={{ needsReply: 5, awaitingMyApproval: 0, total: 5 }} />)
    const inbox = screen.getByRole("link", { name: "Inbox" })
    // The count describes the row; "Inbox" stays its exact name for every
    // locator and screen-reader link list.
    expect(inbox).toHaveAccessibleName("Inbox")
    expect(inbox).toHaveAccessibleDescription("5 reviews need a reply")
  })

  it("counts replies awaiting this person's approval in the Inbox row (R03)", () => {
    render(<Nav waiting={{ needsReply: 2, awaitingMyApproval: 1, total: 3 }} />)
    expect(
      screen.getByRole("link", { name: "Inbox" })
    ).toHaveAccessibleDescription(
      "3 reviews need your attention: 2 to reply, 1 to approve"
    )
  })

  it("keeps rail labels as accessible names", () => {
    // One markup draws the rail and the sidebar; the label is always text.
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Listings" })).toBeInTheDocument()
  })

  it("carries the needs-reply count onto the rail icon as a badge", () => {
    const { container } = render(
      <Nav waiting={{ needsReply: 140, awaitingMyApproval: 0, total: 140 }} />
    )
    const badge = container.querySelector("[data-slot='rail-count']")
    expect(badge).toHaveTextContent("99+")
    expect(badge).toHaveAttribute("aria-hidden")
  })

  it.each(["member", "viewer"])("leaves Team out for a %s", (role) => {
    render(<Nav role={role} />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
  })

  it.each(["owner", "admin"])("keeps Team for an %s", (role) => {
    render(<Nav role={role} />)
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument()
  })

  // DIRECTION D4: one neutral current-place grammar. Fill, ink, semibold
  // and a heavier icon stroke; no accent and no bar.
  it("marks the current row with the neutral grammar, not the accent", () => {
    pathname.current = "/listings"
    render(<Nav role="owner" />)
    const current = screen.getByRole("link", { name: "Listings" })
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current).toHaveClass(
      "aria-[current=page]:bg-fill",
      "aria-[current=page]:font-semibold",
      "aria-[current=page]:text-ink"
    )
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).not.toMatch(/accent/)
    }
    const icon = current.querySelector("[data-slot='nav-icon']")
    expect(icon).toHaveAttribute("stroke-width", "2")
    expect(icon).toHaveClass("text-ink")
    const other = screen
      .getByRole("link", { name: "Inbox" })
      .querySelector("[data-slot='nav-icon']")
    expect(other).toHaveAttribute("stroke-width", "1.75")
    expect(other).toHaveClass("text-ink-muted")
  })

  it("adds Outbox after Reports once the route exists", () => {
    render(<Nav role="member" showOutbox />)
    const primary = screen.getByRole("navigation", { name: "Primary" })
    const labels = within(primary)
      .getAllByRole("link")
      .map((link) => link.textContent)
    expect(labels.slice(0, 6)).toEqual([
      "Inbox",
      "Listings",
      "Clients",
      "Calendar",
      "Reports",
      "Outbox",
    ])
    expect(screen.getByRole("link", { name: "Outbox" })).toHaveAttribute(
      "href",
      "/outbox"
    )
    // Outbox is daily work, not organisation admin.
    expect(
      within(screen.getByRole("list", { name: "Workspace" })).queryByRole(
        "link",
        { name: "Outbox" }
      )
    ).toBeNull()
    expect(navItemsFor("agency", false, true).map((i) => i.label)).toContain(
      "Outbox"
    )
  })

  it("leaves Outbox out until the route exists", () => {
    render(<Nav role="owner" />)
    expect(screen.queryByRole("link", { name: "Outbox" })).toBeNull()
  })

  it.each([["viewer"], [null]])(
    "leaves Outbox out for role %s, who cannot send",
    (role) => {
      render(<Nav role={role} showOutbox />)
      expect(screen.queryByRole("link", { name: "Outbox" })).toBeNull()
    }
  )
})

describe("command palette entries", () => {
  it("hides owner/admin destinations from members", async () => {
    const { paletteEntriesFor } =
      await import("@/components/app-shell/command-palette")
    const entries = [
      { href: "/inbox", label: "Inbox", icon: () => null },
      { href: "/team", label: "Team", icon: () => null, adminOnly: true },
    ]
    expect(paletteEntriesFor(entries, "viewer").map((e) => e.label)).toEqual([
      "Inbox",
    ])
    expect(paletteEntriesFor(entries, "owner")).toHaveLength(2)
  })
})
