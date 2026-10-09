import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { ReviewPublish } from "@/components/listings/review-publish"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import * as menuApi from "@/lib/api/location-menu"
import { renderWithProviders } from "../helpers/render"

const menus = vi.hoisted(() => ({ value: {} }))
vi.mock("@/components/listings/listing-gate", () => ({
  ListingGate: ({
    children,
  }: {
    children: (entry: { name: string; clientId: null }) => ReactNode
  }) => children({ name: "Riverside", clientId: null }),
}))
vi.mock("@/components/listings/area-frame", () => ({
  ListingAreaHeader: () => null,
}))
vi.mock("@/components/editors/activity-drawer", () => ({
  ActivityDrawer: () => null,
}))
vi.mock("@/lib/queries/use-listing-summary", () => ({
  useListingSummary: () => ({
    data: {
      ...emptyListingSummary({
        locationId: "l1",
        linked: true,
        verified: true,
      }),
      menu: { status: "core_dirty", dirtyCount: 1, eligible: true },
    },
    isPending: false,
  }),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => ({ data: { canPublish: true } }),
}))
vi.mock("@/lib/queries/use-location-profile", () => ({
  useProfile: () => ({ isPending: false }),
}))
vi.mock("@/lib/queries/use-location-hours", () => ({
  useHours: () => ({ isPending: false }),
}))
vi.mock("@/lib/queries/use-location-menu", () => ({
  useFoodMenus: () => ({ data: menus.value, isPending: false }),
}))

const item = (description: string) => ({
  labels: [{ displayName: "Soup", description }],
})
const menu = (descriptions: string[]) => [
  {
    sections: [
      { labels: [{ displayName: "Starters" }], items: descriptions.map(item) },
    ],
  },
]
function state(google: string[], canonical: string[]) {
  return {
    canonicalResource: { revision: "4" },
    canonicalMenus: menu(canonical),
    googleMenus: menu(google),
    canonicalHash: "reviewed-local",
    googleHash: "reviewed-google",
    status: "drift",
  }
}
afterEach(() => vi.restoreAllMocks())

describe("aggregate menu review", () => {
  it("does not reread and substitute newer preconditions at publish time", async () => {
    const user = userEvent.setup()
    menus.value = state(["A"], ["B"])
    const refresh = vi.spyOn(menuApi, "fetchFoodMenus")
    const publish = vi
      .spyOn(menuApi, "publishFoodMenus")
      .mockResolvedValue({ status: "published" })
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await user.click(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    )
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith("l1", {
        expectedCanonicalRevision: "4",
        expectedCanonicalHash: "reviewed-local",
        expectedGoogleHash: "reviewed-google",
      })
    )
    expect(refresh).not.toHaveBeenCalled()
  })
  it("blocks unresolved duplicate matches in aggregate review", () => {
    menus.value = state(["A", "B"], ["C", "D"])
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(
      screen.getByText("Resolve this comparison before publishing")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    ).toHaveAttribute("aria-disabled", "true")
  })
  it("shows no changes for duplicate equality even if a cached summary says dirty", () => {
    menus.value = state(["A", "A"], ["A", "A"])
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(screen.getByText("In sync with Google")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    ).toHaveAttribute("aria-disabled", "true")
  })
})
