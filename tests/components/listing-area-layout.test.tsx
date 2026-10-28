import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const segment = vi.hoisted(() => ({ value: null as string | null }))
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment.value,
  usePathname: () => "/listings/l1",
}))

vi.mock("@/components/listings/listing-gate", () => ({
  ListingGate: ({
    children,
  }: {
    children: (entry: unknown) => React.ReactNode
  }) => children({ id: "l1", name: "Riverside", clientId: null, linked: true }),
}))
vi.mock("@/components/editors/activity-drawer", () => ({
  ActivityDrawer: () => null,
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({ data: [] }),
}))
vi.mock("@/lib/queries/use-listing-summary", () => ({
  useListingSummary: () => ({ data: undefined, isError: false }),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => ({ data: undefined }),
}))

import ListingLoading from "@/app/(dashboard)/listings/[id]/loading"
import { ListingAreaLayout } from "@/components/listings/area-frame"
import { InAreaFrameContext } from "@/components/listings/area-frame-context"
import { renderWithProviders } from "../helpers/render"

describe("the listing layout's frame", () => {
  it("passes the overview straight through (it draws its own header)", () => {
    segment.value = null
    const { container } = render(
      <ListingAreaLayout locationId="l1" role="owner">
        <p>page</p>
      </ListingAreaLayout>
    )
    expect(container.innerHTML).toBe("<p>page</p>")
  })

  it("wraps Review & publish in the shared frame, as an area (LST-14)", () => {
    segment.value = "changes"
    renderWithProviders(
      <ListingAreaLayout locationId="l1" role="owner">
        <p>page</p>
      </ListingAreaLayout>
    )
    expect(
      document.querySelector('[data-slot="listing-area-header"]')
    ).not.toBeNull()
    expect(
      screen.getByRole("region", { name: "Review & publish" })
    ).toHaveTextContent("page")
  })
})

describe("the listing's loading state", () => {
  it("draws only the editor's card under a frame that stays", () => {
    const { container } = render(
      <InAreaFrameContext.Provider value>
        <ListingLoading />
      </InAreaFrameContext.Provider>
    )
    expect(container.children).toHaveLength(1)
    const status = screen.getByRole("status")
    expect(status).toBe(container.firstElementChild)
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading this page…")
    // The rows the editor's own loading state draws next, not a block.
    expect(status.querySelector('[data-slot="skeleton-list"]')).not.toBeNull()
  })

  it("draws the whole page's shape outside a frame", () => {
    render(<ListingLoading />)
    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(3)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading this listing…"
    )
  })
})
