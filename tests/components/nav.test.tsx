import { render, screen } from "@testing-library/react"
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
  MORE_ITEMS,
  Nav,
  NAV_ITEMS,
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
  it("offers three destinations and a More disclosure, and no Home", () => {
    render(<Nav />)
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Inbox",
      "Clients",
      "Reports",
    ])
    for (const [label, href] of [
      ["Inbox", "/inbox"],
      ["Clients", "/clients"],
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

  it("keeps Team and Settings behind More until asked", async () => {
    render(<Nav />)
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "More" }))
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    for (const item of MORE_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href
      )
    }
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

  it("keeps Clients selected inside a location workspace", () => {
    expect(isClientsActive("/locations/abc/photos")).toBe(true)
    expect(isClientsActive("/clients/c1")).toBe(true)
    expect(isClientsActive("/inbox")).toBe(false)
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

  it("closes the mobile sheet when a destination is chosen", async () => {
    const onNavigate = vi.fn()
    render(<Nav clients={clients} onNavigate={onNavigate} />)
    screen.getByRole("link", { name: "Inbox" }).click()
    expect(onNavigate).toHaveBeenCalled()
    screen.getByRole("link", { name: /Old Crown Group/ }).click()
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })
})
