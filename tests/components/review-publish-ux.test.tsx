import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReviewPublish } from "@/components/listings/review-publish"
import { ApiClientError } from "@/lib/api/client"
import * as hoursApi from "@/lib/api/location-hours"
import * as menuApi from "@/lib/api/location-menu"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import { LISTING_CHANGE_AWAITING_APPROVAL } from "@/lib/contracts/wire-codes"
import { emptyHours } from "@/lib/locations/forms/hours"
import { renderWithProviders } from "../helpers/render"

/**
 * Review & publish (p4-F09): the done state says only what the server
 * answered, a role that can't publish gets no dead controls, an area Google
 * failed to read can be left out, a disabled Publish says why in the bar,
 * and success moves focus to the result.
 */

type Caps = {
  canPublish: boolean
  canEditCanonical: boolean
  canRequestApproval?: boolean
}
const ctx = vi.hoisted(() => ({
  caps: { canPublish: true, canEditCanonical: true } as Caps,
  hoursDirty: false,
  menu: {} as unknown,
  hours: { isPending: false } as Record<string, unknown>,
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
      menu: { status: "core_dirty", dirtyCount: 1, eligible: true },
      ...(ctx.hoursDirty
        ? { hours: { status: "core_dirty", dirtyCount: 1 } }
        : null),
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
  useHours: () => ctx.hours,
  useRefreshHours: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock("@/lib/queries/use-location-menu", () => ({
  useFoodMenus: () => ({ data: ctx.menu, isPending: false }),
}))

const menuOf = (descriptions: string[]) => [
  {
    sections: [
      {
        labels: [{ displayName: "Starters" }],
        items: descriptions.map((description) => ({
          labels: [{ displayName: "Soup", description }],
        })),
      },
    ],
  },
]
const menuState = {
  canonicalResource: { revision: "4" },
  canonicalMenus: menuOf(["B"]),
  googleMenus: menuOf(["A"]),
  canonicalHash: "reviewed-local",
  googleHash: "reviewed-google",
  status: "drift",
}
function hoursState(extra: Record<string, unknown> = {}) {
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
  canonical.moreHours[0]!.periods[0]!.closesAt = "03:00"
  return {
    isPending: false,
    data: {
      canonical,
      google,
      canonicalResource: { revision: "4" },
      canonicalHash: "local",
      googleHash: "google",
      status: "core_dirty",
      updateMask: ["moreHours"],
      supportedHoursTypes: [
        { hoursTypeId: "BAR", displayName: "Synthetic bar" },
      ],
      ...extra,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  ctx.caps = { canPublish: true, canEditCanonical: true }
  ctx.hoursDirty = false
  ctx.menu = menuState
  ctx.hours = { isPending: false }
})
ctx.menu = menuState

const publishButton = () =>
  screen.getByRole("button", { name: /^(Publish \d+ areas? to Google)$/ })
const barStatus = () =>
  screen
    .getByRole("region", { name: "Publish to Google" })
    .querySelector('[data-slot="action-bar-status"]') as HTMLElement
const pageHeading = (name: string) => {
  const toasts = screen.getByRole("region", { name: "Notifications" })
  return screen
    .getAllByRole("heading", { level: 2, name })
    .find((heading) => !toasts.contains(heading))
}

describe("the done state says only what the server answered", () => {
  it("a parked write says sent for approval, never that Google accepted it", async () => {
    vi.spyOn(menuApi, "publishFoodMenus").mockRejectedValue(
      new ApiClientError(409, LISTING_CHANGE_AWAITING_APPROVAL, "held")
    )
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await userEvent.setup().click(publishButton())
    await waitFor(() => expect(pageHeading("Sent for approval")).toBeTruthy())
    const result = pageHeading("Sent for approval")!.closest(
      '[data-slot="empty"]'
    ) as HTMLElement
    expect(result).toHaveTextContent(
      "Nothing has gone to Google yet. Another publisher needs to approve this change first."
    )
    expect(result).toHaveAttribute("data-tone", "neutral")
    expect(screen.queryByText(/Google accepted every change/)).toBeNull()
    expect(screen.queryByText(/Live on Google/)).toBeNull()
  })

  it("a write the server only says was sent says so", async () => {
    vi.spyOn(menuApi, "publishFoodMenus").mockResolvedValue({
      status: "published",
      operation: { operationId: "op-1", outcome: "sent" },
    } as Awaited<ReturnType<typeof menuApi.publishFoodMenus>>)
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await userEvent.setup().click(publishButton())
    await waitFor(() => expect(pageHeading("Sent to Google")).toBeTruthy())
    expect(
      pageHeading("Sent to Google")!.closest('[data-slot="empty"]')
    ).toHaveTextContent(
      "The change left NabaPresence. Google hasn’t confirmed it yet."
    )
    expect(screen.queryByText(/Google accepted every change/)).toBeNull()
  })

  it("a mix of live and parked writes points at the steps", async () => {
    ctx.hoursDirty = true
    ctx.hours = hoursState()
    vi.spyOn(hoursApi, "publishHours").mockRejectedValue(
      new ApiClientError(409, LISTING_CHANGE_AWAITING_APPROVAL, "held")
    )
    vi.spyOn(menuApi, "publishFoodMenus").mockResolvedValue({
      status: "published",
    } as Awaited<ReturnType<typeof menuApi.publishFoodMenus>>)
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await userEvent.setup().click(publishButton())
    expect(
      await screen.findByText(
        "Not every change is live on Google yet. Each step above says where it stands."
      )
    ).toBeVisible()
    expect(screen.queryByText(/Google accepted every change/)).toBeNull()
  })

  it("keeps the accepted-and-read-back sentence for a confirmed publish, and moves focus to the result", async () => {
    vi.spyOn(menuApi, "publishFoodMenus").mockResolvedValue({
      status: "published",
    } as Awaited<ReturnType<typeof menuApi.publishFoodMenus>>)
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    await userEvent.setup().click(publishButton())
    await waitFor(() => expect(pageHeading("Live on Google")).toBeTruthy())
    const result = pageHeading("Live on Google")!.closest(
      '[data-slot="empty"]'
    ) as HTMLElement
    expect(result).toHaveTextContent(
      "Google accepted every change and read it back as sent."
    )
    expect(result).toHaveAttribute("data-tone", "ok")
    // Focus is on the result, not left on <body> after the bar unmounts.
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent("Live on Google")
    )
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toContainElement(
      screen.getByRole("list", { name: "Publish results" })
    )
  })
})

describe("a role that can't publish reads the page", () => {
  it("gets no include or overwrite checkboxes and no publish bar", () => {
    ctx.caps = {
      canPublish: false,
      canEditCanonical: false,
      canRequestApproval: true,
    }
    ctx.hoursDirty = true
    // A Google change too, so the overwrite alert is drawn.
    ctx.hours = hoursState({ status: "conflict" })
    renderWithProviders(<ReviewPublish locationId="l1" role="member" />)
    expect(
      screen.getByText("You can review these changes but not publish them")
    ).toBeVisible()
    expect(
      screen.getByText(/Ask an owner or admin to publish these changes\./)
    ).toBeVisible()
    expect(
      screen.getByText(
        /Requests for approval aren’t available for listings yet\./
      )
    ).toBeVisible()
    expect(screen.getByText(/Google holds a different version/)).toBeVisible()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(
      screen.queryByRole("region", { name: "Publish to Google" })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull()
    // Its editors open read-only, so the row link says View.
    expect(
      screen.getByRole("link", { name: "View food menu" })
    ).toHaveAttribute("href", "/listings/l1/menu")
    expect(screen.queryByRole("link", { name: /^Edit / })).toBeNull()
  })

  it("an editor that can publish keeps the controls and Edit links", () => {
    ctx.hoursDirty = true
    ctx.hours = hoursState()
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    expect(screen.getByRole("link", { name: "Edit food menu" })).toBeVisible()
    expect(
      screen.getByRole("region", { name: "Publish to Google" })
    ).toBeInTheDocument()
  })
})

describe("an area Google failed to read", () => {
  it("can be left out, and the rest then publishes without it", async () => {
    const user = userEvent.setup()
    ctx.hoursDirty = true
    ctx.hours = {
      isPending: false,
      isError: true,
      data: undefined,
      error: new ApiClientError(503, "GOOGLE_UNAVAILABLE", "raw"),
      refetch: vi.fn(),
    }
    const hoursPublish = vi.spyOn(hoursApi, "publishHours")
    const menuPublish = vi
      .spyOn(menuApi, "publishFoodMenus")
      .mockResolvedValue({ status: "published" } as Awaited<
        ReturnType<typeof menuApi.publishFoodMenus>
      >)
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    expect(
      screen.getByText("We couldn’t read opening hours from Google")
    ).toBeVisible()
    expect(publishButton()).toHaveAttribute("aria-disabled", "true")
    expect(barStatus()).toHaveTextContent(
      "Couldn’t read opening hours from Google. Try again above first."
    )

    await user.click(
      screen.getByRole("checkbox", {
        name: "Include opening hours in this publish",
      })
    )
    const button = screen.getByRole("button", {
      name: "Publish 1 area to Google",
    })
    expect(button).not.toHaveAttribute("aria-disabled", "true")
    await user.click(button)
    await waitFor(() => expect(menuPublish).toHaveBeenCalledTimes(1))
    // Pinned to the hashes read for the page, exactly as before.
    expect(menuPublish).toHaveBeenCalledWith(
      "l1",
      {
        expectedCanonicalRevision: "4",
        expectedCanonicalHash: "reviewed-local",
        expectedGoogleHash: "reviewed-google",
      },
      { intentId: expect.any(String) }
    )
    expect(hoursPublish).not.toHaveBeenCalled()
  })
})

describe("why Publish is off", () => {
  it("is said in the bar when no area is included, not only in a tooltip", async () => {
    ctx.hoursDirty = true
    ctx.hours = hoursState()
    const user = userEvent.setup()
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    for (const checkbox of screen.getAllByRole("checkbox"))
      await user.click(checkbox)
    expect(barStatus()).toHaveTextContent(
      "Include at least one area to publish."
    )
    expect(barStatus()).not.toHaveTextContent(/will change on Google/)
    expect(publishButton()).toHaveAttribute("aria-disabled", "true")
  })
})

describe("hours that need review first", () => {
  it("offers the way to the hours editor in the alert", () => {
    ctx.hoursDirty = true
    ctx.hours = hoursState({ reconciliationRequired: true })
    renderWithProviders(<ReviewPublish locationId="l1" role="owner" />)
    const alert = screen
      .getByText("Hours need review before publishing")
      .closest('[data-slot="alert"]') as HTMLElement
    expect(
      within(alert).getByRole("link", { name: "Open hours editor" })
    ).toHaveAttribute("href", "/listings/l1/hours")
  })
})
