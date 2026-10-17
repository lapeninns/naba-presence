import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReviewPublish } from "@/components/listings/review-publish"
import { ApiClientError } from "@/lib/api/client"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import * as menuApi from "@/lib/api/location-menu"
import { renderWithProviders } from "../helpers/render"

const menus = vi.hoisted(() => ({ value: {} }))
const ctx = vi.hoisted(() => ({
  caps: { canPublish: true, canEditCanonical: true },
  dirty: true,
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [{ id: "l1", name: "Riverside", clientId: null }],
  }),
}))
vi.mock("@/lib/queries/use-listing-summary", () => ({
  useListingSummary: () => ({
    data: {
      ...emptyListingSummary({
        locationId: "l1",
        linked: true,
        verified: true,
      }),
      menu: ctx.dirty
        ? { status: "core_dirty", dirtyCount: 1, eligible: true }
        : { status: "in_sync", dirtyCount: 0, eligible: true },
    },
    isPending: false,
  }),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => ({ data: ctx.caps }),
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
afterEach(() => {
  vi.restoreAllMocks()
  ctx.caps = { canPublish: true, canEditCanonical: true }
  ctx.dirty = true
})

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
      expect(publish).toHaveBeenCalledWith(
        "l1",
        {
          expectedCanonicalRevision: "4",
          expectedCanonicalHash: "reviewed-local",
          expectedGoogleHash: "reviewed-google",
        },
        { intentId: expect.any(String) }
      )
    )
    expect(refresh).not.toHaveBeenCalled()
  })
  it("says live only once the verified publish has finished", async () => {
    const user = userEvent.setup()
    menus.value = state(["A"], ["B"])
    let answer: (value: { status: "published" }) => void = () => {}
    vi.spyOn(menuApi, "publishFoodMenus").mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }) as ReturnType<typeof menuApi.publishFoodMenus>
    )
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await user.click(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    )
    // In flight: the request left the app and Google hasn't answered.
    expect(
      await screen.findByText("Sent to Google — waiting for the answer")
    ).toBeInTheDocument()
    expect(screen.queryByText("Live on Google")).toBeNull()

    answer({ status: "published" })
    const finished = () =>
      within(screen.getByRole("list", { name: "Publish results" })).getByRole(
        "listitem"
      )
    await waitFor(() =>
      expect(finished()).toHaveAttribute("data-state", "confirmed_applied")
    )
    const step = finished()
    expect(step).toHaveTextContent("Live on Google")
    const toasts = screen.getByRole("region", { name: "Notifications" })
    expect(await within(toasts).findByText("Live on Google")).toBeVisible()
    // The page's own result heading, not only the toast's.
    expect(
      screen
        .getAllByRole("heading", { level: 2, name: "Live on Google" })
        .some((heading) => !toasts.contains(heading))
    ).toBe(true)
    expect(screen.queryByText("Accepted by Google")).toBeNull()
  })
  it("docks the publish bar through ActionBar, so its measured height is published", () => {
    menus.value = state(["A"], ["B"])
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    const bar = screen.getByRole("region", { name: "Publish to Google" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    // The ActionBar's own spacer (not a hand-written padding) reserves the
    // bar's height, and the one primary sits in the bar.
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    expect(
      within(bar).getByRole("button", { name: "Publish 1 area to Google" })
    ).toBeInTheDocument()
    // The status has its own row on a phone, so a block reason is readable.
    expect(bar.className).toMatch(/max-md:flex-wrap/)
    expect(
      bar.querySelector('[data-slot="action-bar-status"]')?.className
    ).toMatch(/max-md:basis-full/)
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
    expect(screen.getByText("In sync")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    ).toHaveAttribute("aria-disabled", "true")
  })
})

describe("publish failure and read-only views", () => {
  it("states a failure once: one line on the step, one banner, a short toast, the code folded away", async () => {
    const user = userEvent.setup()
    menus.value = state(["A"], ["B"])
    vi.spyOn(menuApi, "publishFoodMenus").mockRejectedValue(
      new ApiClientError(404, "NOT_FOUND", "raw")
    )
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await user.click(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    )
    const banner = await screen.findByText(/Publishing stopped at/)
    expect(banner).toBeVisible()
    // The reason is on the step, and only there.
    expect(
      screen.getAllByText(/Google couldn’t find that account or listing/)
    ).toHaveLength(1)
    expect(screen.queryByText(/Earlier steps were sent/)).toBeNull()
    expect(
      screen.queryByText(/did not finish with a confirmed result/)
    ).toBeNull()
    // The toast is short, and there is no second Retry on the step.
    const toasts = screen.getByRole("region", { name: "Notifications" })
    expect(
      await within(toasts).findByText("Publishing stopped. See the steps.")
    ).toBeVisible()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Retry publishing" })
    ).toBeInTheDocument()
    // The code is behind "Details for support", closed.
    const steps = screen.getByRole("list", { name: "Publish results" })
    expect(within(steps).getByText("Details for support")).toBeVisible()
    expect(within(steps).getByText("NOT_FOUND")).not.toBeVisible()
  })
  it("says to check Google first when the failed step was sent but not confirmed", async () => {
    const user = userEvent.setup()
    menus.value = state(["A"], ["B"])
    vi.spyOn(menuApi, "publishFoodMenus").mockRejectedValue(
      new DOMException("unconfirmed", "TimeoutError")
    )
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await user.click(
      screen.getByRole("button", { name: "Publish 1 area to Google" })
    )
    expect(
      await screen.findByText(/Check Google, then retry publishing/)
    ).toBeVisible()
  })
  it("tells a role that cannot edit that nothing is waiting, not to edit", () => {
    ctx.dirty = false
    ctx.caps = { canPublish: false, canEditCanonical: false }
    renderWithProviders(<ReviewPublish locationId="l1" role="member" />)
    expect(
      screen.getAllByText(/Nothing is waiting to go to Google/).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/Edit an area and come back/)).toBeNull()
  })
  it("still tells an editor to edit an area and come back", () => {
    ctx.dirty = false
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(screen.getByText(/Edit an area and come back/)).toBeVisible()
  })
})
