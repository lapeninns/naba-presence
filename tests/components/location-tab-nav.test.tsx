import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1/hours" }))

describe("LocationTabNav", () => {
  it("renders the six wave-1 tabs and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" />)
    const nav = screen.getByRole("navigation", { name: "Location sections" })
    for (const label of ["Profile", "Hours", "Photos", "Posts", "Booking", "Menu"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Hours" })).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
    // No deferred tabs leak into wave 1.
    for (const gone of ["Business info", "Industry", "Administration", "Reviews", "Performance"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
