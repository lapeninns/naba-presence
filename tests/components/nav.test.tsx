import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/home" }))
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

import { isClientsActive, Nav, NAV_GROUPS } from "@/components/app-shell/nav"
import type { NavClient } from "@/components/app-shell/nav"

const clients: NavClient[] = [
  { id: "c1", name: "Old Crown Group", health: "healthy" },
  { id: "c2", name: "Harbour Kitchen", health: "disconnected" },
]

describe("primary navigation", () => {
  it("offers the six agency destinations", () => {
    render(<Nav />)
    for (const [label, href] of [
      ["Home", "/home"],
      ["Inbox", "/inbox"],
      ["Clients", "/clients"],
      ["Reports", "/reports"],
      ["Team", "/team"],
      ["Settings", "/settings"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href)
    }
  })

  it("groups items without introducing a heading", () => {
    // `heading-order` and `page-has-heading-one` are pinned axe rules, and a
    // heading in the sidebar would sit above the page's own h1. The groups
    // are labelled with plain spans instead.
    const { container } = render(<Nav />)
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
    for (const group of NAV_GROUPS) {
      expect(
        screen.getByRole("group", { name: group.label })
      ).toBeInTheDocument()
    }
  })

  it("marks exactly one item as the current page", () => {
    pathname.current = "/home"
    render(<Nav />)
    const active = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Home")
  })

  it("keeps Clients selected inside a location workspace", () => {
    // A location is reached through its client and the breadcrumb says so, so
    // leaving the sidebar with nothing selected there would strand the user.
    expect(isClientsActive("/locations/abc/hours")).toBe(true)
    expect(isClientsActive("/clients/c1")).toBe(true)
    expect(isClientsActive("/inbox")).toBe(false)
  })

  it("pins recent clients with their health under Clients", () => {
    render(<Nav clients={clients} />)
    expect(screen.getByRole("link", { name: /Old Crown Group/ })).toHaveAttribute(
      "href",
      "/clients/c1"
    )
    expect(screen.getByRole("link", { name: /Harbour Kitchen/ })).toBeInTheDocument()
  })

  it("shows no client sub-items before the list has loaded", () => {
    render(<Nav />)
    expect(screen.queryByRole("link", { name: /Old Crown Group/ })).not.toBeInTheDocument()
  })

  it("closes the mobile sheet when a destination is chosen", async () => {
    const onNavigate = vi.fn()
    render(<Nav clients={clients} onNavigate={onNavigate} />)
    screen.getByRole("link", { name: "Inbox" }).click()
    expect(onNavigate).toHaveBeenCalled()
    screen.getByRole("link", { name: /Old Crown Group/ }).click()
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })
})
