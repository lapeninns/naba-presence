import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/locations/loc-1/administration",
}))

// The nav decorates tabs with import-review pending counts; the counts hook
// needs a QueryClientProvider, which these structural tests don't mount.
vi.mock("@/lib/queries/use-import-review", () => ({
  useImportReviewCounts: () => ({ data: undefined }),
}))

describe("LocationTabNav", () => {
  it("groups every tab under a job section and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    // No "Overview" section: it held a single Profile tab, so the heading
    // only ever repeated the tab beneath it.
    for (const label of ["Profile", "Content", "Customers", "Access", "Insights"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    for (const label of [
      "Profile",
      "Hours",
      "Photos",
      "Posts",
      "Booking",
      "Menu",
      "Performance",
      "Business info",
      "Industry",
      "Access",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    const active = screen.getByRole("link", { name: "Access" })
    expect(active).toHaveAttribute("href", "/locations/loc-1/administration")
    expect(active).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument()
  })

  it("hides the owner/admin-only consoles for a member (no reachable 403)", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles={false} />)
    expect(screen.getByRole("link", { name: "Business info" })).toBeInTheDocument()
    for (const gone of ["Industry", "Access"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
    // The whole Access section disappears rather than rendering an empty
    // heading, because every tab in it is console-gated.
    expect(screen.queryByText("Access")).not.toBeInTheDocument()
  })
})
