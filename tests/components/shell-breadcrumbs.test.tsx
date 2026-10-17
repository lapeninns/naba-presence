import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ShellBreadcrumbs } from "@/components/app-shell/breadcrumbs-context"
import {
  PageChrome,
  PageChromeProvider,
} from "@/components/app-shell/page-chrome"

const pathname = vi.hoisted(() => ({ current: "/listings/l2/people" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({ data: { items: [] } }),
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [
      {
        id: "l2",
        name: "Stub location 2122d2d2 with a long name",
        clientId: null,
        clientName: null,
      },
    ],
  }),
}))

/**
 * jsdom has no layout, so these pin the flex contract that keeps the trail
 * inside its nav at 768px: every crumb may shrink (none overflow under the
 * health pill), ancestors give way first, and each label truncates with an
 * ellipsis while its full text stays available.
 */
describe("ShellBreadcrumbs", () => {
  beforeEach(() => {
    pathname.current = "/listings/l2/people"
  })

  it("lets every crumb shrink so the trail never runs under the toolbar pill", () => {
    render(<ShellBreadcrumbs className="min-w-0 flex-1" />)

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    const items = nav.querySelectorAll("li")
    // Listings / … / People: the middle folds (DSK-05).
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.className).toContain("min-w-0")
      expect(item.className).not.toMatch(/(^|\s)shrink-0(\s|$)/)
    }
    // Ancestors shrink far faster than the current page.
    const ancestors = nav.querySelectorAll('[data-slot="breadcrumb-ancestor"]')
    expect(ancestors).toHaveLength(2)
    for (const ancestor of ancestors) {
      expect(ancestor.className).toContain("shrink-[100]")
    }
  })

  it("keeps the current crumb readable: truncated with an ellipsis and titled in full", () => {
    render(<ShellBreadcrumbs />)

    const current = screen.getByText("People")
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current.className).toContain("truncate")
    expect(current.className).toContain("min-w-0")
    expect(current).toHaveAttribute("title", "People")

    const ancestor = screen.getByRole("link", { name: "Listings" })
    expect(ancestor.className).toContain("truncate")
    expect(ancestor).toHaveAttribute("title", "Listings")
  })

  it('folds the middle crumbs into a "…" menu that still links to each (DSK-05)', async () => {
    render(<ShellBreadcrumbs />)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    // The listing's name is in the page header, not repeated in the trail.
    expect(
      screen.queryByRole("link", {
        name: "Stub location 2122d2d2 with a long name",
      })
    ).toBeNull()
    const fold = nav.querySelector<HTMLElement>(
      '[data-slot="breadcrumb-folded"]'
    )!
    expect(fold).toHaveAccessibleName("Earlier pages in the trail")
    await userEvent.click(fold)
    expect(
      await screen.findByRole("menuitem", {
        name: "Stub location 2122d2d2 with a long name",
      })
    ).toHaveAttribute("href", "/listings/l2")
    expect(screen.getByRole("menuitem", { name: "Unfiled" })).toHaveAttribute(
      "href",
      "/listings"
    )
  })

  it("does not fold a trail of three or fewer", () => {
    pathname.current = "/listings/l2"
    render(<ShellBreadcrumbs />)
    expect(document.querySelector('[data-slot="breadcrumb-folded"]')).toBeNull()
  })

  it("puts the page's registered count after the current crumb, muted", async () => {
    render(
      <PageChromeProvider>
        <ShellBreadcrumbs />
        <PageChrome count={12} countLabel="need a reply" />
      </PageChromeProvider>
    )
    const count = await screen.findByText("12")
    expect(count).toHaveAttribute("data-slot", "breadcrumb-count")
    expect(count).toHaveAttribute("aria-hidden", "true")
    expect(count.className).toContain("text-ink-muted")
    const current = screen.getByText("People")
    expect(current.closest("li")).toContainElement(count)
    expect(current).toHaveAttribute("aria-current", "page")
  })

  it("shows no count when the page registered none", () => {
    render(
      <PageChromeProvider>
        <ShellBreadcrumbs />
      </PageChromeProvider>
    )
    expect(document.querySelector('[data-slot="breadcrumb-count"]')).toBeNull()
  })

  it.each(["/inbox", "/listings", "/reports", "/team", "/notifications"])(
    "draws no trail on %s, where one crumb would repeat the h1",
    (path) => {
      pathname.current = path
      render(<ShellBreadcrumbs />)
      expect(
        screen.queryByRole("navigation", { name: "Breadcrumb" })
      ).toBeNull()
    }
  )

  it("keeps a lone crumb that links to a parent, so there is still a way up", () => {
    // /listings/<id> before the location list has loaded (or for a listing
    // not in it) is just "Listings", linking to the board.
    pathname.current = "/listings/unknown"
    render(<ShellBreadcrumbs />)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(nav.querySelectorAll("li")).toHaveLength(1)
    expect(screen.getByRole("link", { name: "Listings" })).toHaveAttribute(
      "href",
      "/listings"
    )
  })

  it("reads Settings / Reply policy on /settings, as every settings tab does", () => {
    pathname.current = "/settings"
    render(<ShellBreadcrumbs />)
    const items = screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .querySelectorAll("li")
    expect([...items].map((item) => item.textContent)).toEqual([
      "Settings",
      "/Reply policy",
    ])
    expect(screen.getByText("Reply policy")).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it.each([
    ["/settings/policy", "Reply policy"],
    ["/settings/notifications", "Notifications"],
    ["/settings/connections", "Google connections"],
  ])("reads Settings / <page> on %s", (path, label) => {
    pathname.current = path
    render(<ShellBreadcrumbs />)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    )
    expect(screen.getByText(label)).toHaveAttribute("aria-current", "page")
    expect(nav.querySelectorAll("li")).toHaveLength(2)
  })
})
