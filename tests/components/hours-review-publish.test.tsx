import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { ReviewPublish } from "@/components/listings/review-publish"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import * as hoursApi from "@/lib/api/location-hours"
import { emptyHours } from "@/lib/locations/forms/hours"
import { renderWithProviders } from "../helpers/render"

const hours = vi.hoisted(() => ({ value: {} }))
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
      hours: { status: "core_dirty", dirtyCount: 1 },
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
  useHours: () => ({ data: hours.value, isPending: false }),
}))
vi.mock("@/lib/queries/use-location-menu", () => ({
  useFoodMenus: () => ({ isPending: false }),
}))

function state() {
  const google = emptyHours()
  google.moreHours = [
    {
      hoursTypeId: "BAR",
      periods: [
        {
          dayOfWeek: 0,
          closeDayOfWeek: 1,
          opensAt: "18:00",
          closesAt: "02:00",
        },
      ],
    },
  ]
  const canonical = structuredClone(google)
  canonical.moreHours[0].periods[0].closesAt = "03:00"
  return {
    canonical,
    google,
    canonicalResource: { revision: "4" },
    canonicalHash: "local",
    googleHash: "google",
    status: "core_dirty",
    updateMask: ["moreHours"],
    supportedHoursTypes: [{ hoursTypeId: "BAR", displayName: "Synthetic bar" }],
  }
}
afterEach(() => vi.restoreAllMocks())
describe("aggregate hours review", () => {
  it("names exact service times with discovered labels and pinned preconditions", async () => {
    hours.value = state()
    const publish = vi
      .spyOn(hoursApi, "publishHours")
      .mockResolvedValue({ status: "published" })
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(screen.getByText(/Synthetic bar.*Sunday/)).toBeInTheDocument()
    expect(screen.getByText(/3:00 am.*Monday/)).toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Publish 1 area to Google" }))
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({
          expectedCanonicalRevision: "4",
          expectedCanonicalHash: "local",
          expectedGoogleHash: "google",
          approvedUpdateMask: ["moreHours"],
        })
      )
    )
  })
  it.each(["publicationBlocked", "reconciliationRequired"])(
    "explains %s and queues no hours publication",
    (flag) => {
      hours.value = { ...state(), [flag]: true }
      const publish = vi.spyOn(hoursApi, "publishHours")
      renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
      expect(
        screen.getByText("Hours need review before publishing")
      ).toBeInTheDocument()
      expect(screen.getByText("Needs review")).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Publish.*Google/ })
      ).toHaveAttribute("aria-disabled", "true")
      expect(publish).not.toHaveBeenCalled()
    }
  )
})
