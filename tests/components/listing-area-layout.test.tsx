import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const segment = vi.hoisted(() => ({ value: null as string | null }))
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment.value,
  usePathname: () => "/listings/l1",
}))

import ListingLoading from "@/app/(dashboard)/listings/[id]/loading"
import { ListingAreaLayout } from "@/components/listings/area-frame"
import { InAreaFrameContext } from "@/components/listings/area-frame-context"

describe("the listing layout's frame", () => {
  it("passes the overview and Review & publish straight through (they draw their own header)", () => {
    for (const value of [null, "changes"]) {
      segment.value = value
      const { container, unmount } = render(
        <ListingAreaLayout locationId="l1" role="owner">
          <p>page</p>
        </ListingAreaLayout>
      )
      expect(container.innerHTML).toBe("<p>page</p>")
      unmount()
    }
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
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true")
    expect(container.firstElementChild).toHaveAttribute("data-slot", "skeleton")
  })

  it("draws the whole page's shape outside a frame", () => {
    render(<ListingLoading />)
    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(3)
    expect(screen.queryByRole("heading")).toBeNull()
  })
})
