import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1/performance" }))

describe("LocationTabNav", () => {
  it("renders the seven tabs (incl. Performance) and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" />)
    const nav = screen.getByRole("navigation", { name: "Location sections" })
    for (const label of ["Profile", "Hours", "Photos", "Posts", "Booking", "Menu", "Performance"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    const performance = screen.getByRole("link", { name: "Performance" })
    expect(performance).toHaveAttribute("href", "/locations/loc-1/performance")
    expect(performance).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
    // The M8-deferred consoles still must not leak into the workspace tabs.
    for (const gone of ["Business info", "Industry", "Administration", "Reviews"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
