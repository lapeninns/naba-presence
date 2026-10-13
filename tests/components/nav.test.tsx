import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

import {
  isClientsActive,
  isMoreActive,
  Nav,
  navItemsFor,
} from "@/components/app-shell/nav"
import type { NavClient } from "@/components/app-shell/nav"

const clients: NavClient[] = [
  { id: "c1", name: "Old Crown Group", health: "healthy" },
  { id: "c2", name: "Harbour Kitchen", health: "disconnected" },
]

beforeEach(() => {
  pathname.current = "/inbox"
  window.sessionStorage.clear()
})

describe("primary navigation", () => {
  it("offers five destinations and a More disclosure, and no Home", () => {
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
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
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

  it("keeps Team and Settings behind More until asked", async () => {
    // The disclosure is CSS on the desk sidebar (`wide:hidden` while
    // collapsed) because the 768-1180 rail lists the same rows as tiles,
    // so the rows stay in the DOM and the list's class carries the state.
    render(<Nav role="owner" />)
    const more = screen.getByRole("button", { name: "More" })
    const list = document.getElementById(more.getAttribute("aria-controls")!)!
    expect(more).toHaveAttribute("aria-expanded", "false")
    expect(list).toHaveClass("wide:hidden")
    await userEvent.click(more)
    expect(more).toHaveAttribute("aria-expanded", "true")
    expect(list).not.toHaveClass("wide:hidden")
    for (const [label, href] of [
      ["Team", "/team"],
      ["Settings", "/settings"],
    ]) {
      expect(
        within(list).getByRole("link", { name: label })
      ).toHaveAttribute("href", href)
    }
    // From 768px the toolbar's bell is Notifications' place.
    expect(
      screen.queryByRole("link", { name: "Notifications" })
    ).not.toBeInTheDocument()
  })

  it("remembers the More choice for the session", async () => {
    const { unmount } = render(<Nav role="owner" />)
    await userEvent.click(screen.getByRole("button", { name: "More" }))
    unmount()
    render(<Nav role="owner" />)
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
  })

  it("hides Team while the role is still unknown", () => {
    render(<Nav />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
  })

  it("opens More on its own when Team or Settings is the current page", () => {
    pathname.current = "/settings/connections"
    render(<Nav />)
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(isMoreActive("/team")).toBe(true)
    expect(isMoreActive("/inbox")).toBe(false)
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
    expect(isClientsActive("/listings/abc/photos")).toBe(false)
    expect(isClientsActive("/clients/c1")).toBe(true)
    expect(isClientsActive("/inbox")).toBe(false)
    pathname.current = "/listings/abc/photos"
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Listings" })).toHaveAttribute(
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
    render(<Nav needsReply={5} />)
    const inbox = screen.getByRole("link", { name: "Inbox" })
    // The count describes the row; "Inbox" stays its exact name for every
    // locator and screen-reader link list.
    expect(inbox).toHaveAccessibleName("Inbox")
    expect(inbox).toHaveAccessibleDescription("5 reviews need a reply")
  })

  it("names each pinned client's health in words, not only a dot", () => {
    render(<Nav clients={clients} />)
    expect(
      screen.getByRole("link", { name: /Harbour Kitchen, Action needed/i })
    ).toBeInTheDocument()
  })

  it("keeps rail labels as accessible names", () => {
    // One markup draws the rail and the sidebar; the label is always text.
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Listings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument()
  })

  it("carries the needs-reply count onto the rail icon as a badge", () => {
    const { container } = render(<Nav needsReply={140} />)
    const badge = container.querySelector("[data-slot='rail-count']")
    expect(badge).toHaveTextContent("99+")
    expect(badge).toHaveAttribute("aria-hidden")
  })

  it("lets More collapse while one of its pages is current", async () => {
    pathname.current = "/settings"
    render(<Nav />)
    const more = screen.getByRole("button", { name: "More" })
    expect(more).toHaveAttribute("aria-expanded", "true")
    await userEvent.click(more)
    expect(more).toHaveAttribute("aria-expanded", "false")
    expect(more).toHaveAccessibleDescription("Contains the current page")
    await userEvent.click(more)
    expect(more).toHaveAttribute("aria-expanded", "true")
  })

  it.each(["member", "viewer"])("leaves Team out for a %s", async (role) => {
    render(<Nav role={role} />)
    await userEvent.click(screen.getByRole("button", { name: "More" }))
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
  })

  it.each(["owner", "admin"])("keeps Team for an %s", async (role) => {
    render(<Nav role={role} />)
    await userEvent.click(screen.getByRole("button", { name: "More" }))
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
