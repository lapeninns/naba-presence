import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuTab } from "@/components/locations/menu-tab"
import { Toaster } from "@/components/ui/toast"
import type { FoodMenusState } from "@/lib/api/location-menu"

const useMenuMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-menu", () => ({ useFoodMenus: () => useMenuMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeMenus(overrides: Partial<FoodMenusState> = {}): FoodMenusState {
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1" },
    canonicalResource: { revision: "4", updatedAt: "2026-08-01T00:00:00.000Z" },
    eligible: true,
    status: "drift",
    canonicalMenus: [{ labels: [{ displayName: "Mains" }], sections: [{ labels: [{ displayName: "Starters" }], items: [{ labels: [{ displayName: "Soup" }], attributes: { price: { currencyCode: "GBP", units: "6", nanos: 500000000 } } }] }] }],
    googleMenus: [],
    canonicalHash: "ch",
    googleHash: "gh",
    canonicalCounts: { menus: 1, sections: 1, items: 1, options: 0 },
    googleCounts: { menus: 0, sections: 0, items: 0, options: 0 },
    canPublish: true,
    writesEnabled: true,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <MenuTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("MenuTab", () => {
  it("renders the section and item with its price for an owner", () => {
    useMenuMock.mockReturnValue({ data: makeMenus(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByDisplayValue("Starters")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("6.50")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("shows a clear notice when the location cannot have a food menu", () => {
    useMenuMock.mockReturnValue({ data: makeMenus({ eligible: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("This location can’t have a food menu", { exact: false })).toBeInTheDocument()
  })
})
