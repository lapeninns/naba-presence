import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

const pathname = vi.hoisted(() => ({ current: "/locations/loc-1/access" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}))

// The nav decorates the Listing with import-review pending counts; the
// counts hook needs a QueryClientProvider, which these structural tests
// don't mount.
const counts = vi.hoisted(() => ({
  current: [] as { locationId: string; resourceType: string; pending: number }[],
}))
vi.mock("@/lib/queries/use-import-review", () => ({
  useImportReviewCounts: () => ({ data: { counts: counts.current } }),
}))

describe("LocationTabNav", () => {
  it("switches between three jobs and marks the active one", () => {
    pathname.current = "/locations/loc-1/access"
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    for (const [label, href] of [
      ["Listing", "/locations/loc-1"],
      ["Content", "/locations/loc-1/photos"],
      ["Access", "/locations/loc-1/access"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }
    expect(screen.getByRole("link", { name: "Access" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    // The Access job's own views sit beneath it, People being current.
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Verification" })).toHaveAttribute(
      "href",
      "/locations/loc-1/verification"
    )
    // Retired: Performance is a report now, and nothing here is a tab.
    for (const gone of ["Performance", "Business info", "Industry", "Reviews"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })

  it("lists the Listing's sections as in-page anchors", () => {
    pathname.current = "/locations/loc-1"
    counts.current = [
      { locationId: "loc-1", resourceType: "profile", pending: 2 },
      { locationId: "loc-1", resourceType: "food_menus", pending: 1 },
      { locationId: "loc-2", resourceType: "profile", pending: 9 },
    ]
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    expect(screen.getByRole("link", { name: "Listing, 3 suggestions from Google" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    const onThisPage = screen.getByRole("list", { name: "On this page" })
    expect(onThisPage.querySelector('a[href="#hours"]')).toHaveTextContent("Hours")
    expect(onThisPage.querySelector('a[href="#booking"]')).toHaveTextContent("Booking")
    expect(
      screen.getByRole("link", { name: "Suggested updates, 3 suggestions from Google" })
    ).toHaveAttribute("href", "#suggestions")
    // Another job's views are not drawn while the Listing is open.
    expect(screen.queryByRole("link", { name: "Photos" })).not.toBeInTheDocument()
    counts.current = []
  })

  it("shows the Content views when a content route is open", () => {
    pathname.current = "/locations/loc-1/menu"
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    expect(screen.getByRole("link", { name: "Content" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Menu" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Photos" })).toHaveAttribute(
      "href",
      "/locations/loc-1/photos"
    )
    expect(screen.queryByRole("list", { name: "On this page" })).not.toBeInTheDocument()
  })

  it("hides the owner/admin-only Access job for a member (no reachable 403)", () => {
    pathname.current = "/locations/loc-1"
    render(<LocationTabNav locationId="loc-1" canManageConsoles={false} />)
    expect(screen.getByRole("link", { name: "Listing" })).toBeInTheDocument()
    for (const gone of ["Access", "People", "Verification"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
