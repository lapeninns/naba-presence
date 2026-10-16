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
import type { NavClient } from "@/components/app-shell/nav"

const clients: NavClient[] = [
  { id: "c1", name: "Old Crown Group", health: "healthy" },
  { id: "c2", name: "Harbour Kitchen", health: "disconnected" },
]

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
    render(<Nav clients={clients} scopeClientId="c2" />)
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
    render(<Nav role="owner" clients={clients} />)
    const active = currentLinks()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName(name)
  })

  it("marks the pinned client, and only it, on a client page", () => {
    // Both rows used to carry the tint and `aria-current` (DSK-09).
    pathname.current = "/clients/c1"
    render(<Nav clients={clients} />)
    const active = currentLinks()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName(/Old Crown Group/)
    // The parent says it contains the current page by colour alone.
    const parent = screen.getByRole("link", { name: "Clients" })
    expect(parent).not.toHaveAttribute("aria-current")
    expect(parent).toHaveClass("text-accent-ink")
  })

  it("marks the pinned client on a page beneath it", () => {
    pathname.current = "/clients/c2/settings"
    render(<Nav clients={clients} />)
    const active = currentLinks()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName(/Harbour Kitchen/)
  })

  it("marks Clients on a client page in the rail, which draws no pinned rows", () => {
    // Below `wide` the pinned clients are hidden, so a mark on one would
    // leave the visible column with no current page.
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    pathname.current = "/clients/c1"
    render(<Nav clients={clients} />)
    const active = currentLinks()
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Clients")
  })

  it("marks Clients on a client that is not pinned", () => {
    pathname.current = "/clients/c9"
    render(<Nav clients={clients} />)
    expect(currentLinks()).toHaveLength(1)
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("pins recent clients with their health under Clients", () => {
    render(<Nav clients={clients} />)
    expect(
      screen.getByRole("link", { name: /Old Crown Group/ })
    ).toHaveAttribute("href", "/clients/c1")
    expect(
      screen.getByRole("link", { name: /Harbour Kitchen/ })
    ).toBeInTheDocument()
  })

  it("shows no client sub-items before the list has loaded", () => {
    render(<Nav />)
    expect(
      screen.queryByRole("link", { name: /Old Crown Group/ })
    ).not.toBeInTheDocument()
  })

  it("reports a chosen destination through onNavigate", async () => {
    const onNavigate = vi.fn()
    render(<Nav clients={clients} onNavigate={onNavigate} />)
    screen.getByRole("link", { name: "Inbox" }).click()
    expect(onNavigate).toHaveBeenCalled()
    screen.getByRole("link", { name: /Old Crown Group/ }).click()
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

  it("names each pinned client's health in words, not only a dot", () => {
    render(<Nav clients={clients} />)
    expect(
      screen.getByRole("link", { name: /Harbour Kitchen, Google login disconnected/i })
    ).toBeInTheDocument()
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
