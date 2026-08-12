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
  it("renders grouped sections with all ten tabs for an owner/admin and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    for (const label of ["Overview", "Content", "Customers", "Access", "Insights"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
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
      "Administration",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    const active = screen.getByRole("link", { name: "Administration" })
    expect(active).toHaveAttribute("href", "/locations/loc-1/administration")
    expect(active).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument()
  })

  it("hides the owner/admin-only consoles for a member (no reachable 403)", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles={false} />)
    expect(screen.getByRole("link", { name: "Business info" })).toBeInTheDocument()
    for (const gone of ["Industry", "Administration"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
    expect(screen.queryByText("Access")).not.toBeInTheDocument()
  })
})
