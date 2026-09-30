import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ShellBreadcrumbs } from "@/components/app-shell/breadcrumbs-context"

vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l2/people",
}))
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
  it("lets every crumb shrink so the trail never runs under the toolbar pill", () => {
    render(<ShellBreadcrumbs className="min-w-0 flex-1" />)

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    const items = nav.querySelectorAll("li")
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.className).toContain("min-w-0")
      expect(item.className).not.toMatch(/(^|\s)shrink-0(\s|$)/)
    }
    // Ancestors shrink far faster than the current page.
    const ancestors = nav.querySelectorAll('[data-slot="breadcrumb-ancestor"]')
    expect(ancestors).toHaveLength(3)
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

    const ancestor = screen.getByRole("link", {
      name: "Stub location 2122d2d2 with a long name",
    })
    expect(ancestor.className).toContain("truncate")
    expect(ancestor).toHaveAttribute(
      "title",
      "Stub location 2122d2d2 with a long name"
    )
  })
})
