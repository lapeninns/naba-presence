import { render, screen, within } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1",
  notFound: vi.fn(),
}))
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/components/editors/activity-drawer", () => ({
  ActivityDrawer: () => <button type="button">Activity</button>,
}))
vi.mock("@/components/listings/recent-activity", () => ({
  RecentActivity: () => <p>recent activity</p>,
}))

import { ListingOverview } from "@/components/listings/listing-overview"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import * as capsHook from "@/lib/queries/use-location-capabilities"
import * as summaryHook from "@/lib/queries/use-listing-summary"
import * as locationsHook from "@/lib/queries/use-locations"

function stub({
  summary,
  caps,
}: {
  summary: ListingSummary | undefined
  caps?: LocationCapabilities
}) {
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: [
      {
        id: "l1",
        name: "Old Crown Girton",
        linked: true,
        verified: true,
        clientId: "c1",
        clientName: "Old Crown Group",
        address: { addressLines: ["89 High Street"], locality: "Girton" },
      },
      {
        id: "l2",
        name: "Old Crown Cambridge",
        linked: true,
        verified: true,
        clientId: "c1",
        clientName: "Old Crown Group",
      },
    ],
    isPending: false,
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.spyOn(summaryHook, "useListingSummary").mockReturnValue({
    data: summary,
    isPending: summary === undefined,
  } as unknown as UseQueryResult<ListingSummary>)
  vi.spyOn(capsHook, "useLocationCapabilities").mockReturnValue({
    data: caps ?? { canEditCanonical: true, canPublish: true, resources: {} },
    isPending: false,
  } as unknown as UseQueryResult<LocationCapabilities>)
}

function summary(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    ...emptyListingSummary({ locationId: "l1", linked: true, verified: true }),
    connection: {
      status: "active",
      reconnectRequired: false,
      googleEmail: "owner@example.com",
    },
    profile: {
      status: "in_sync",
      dirtyCount: 0,
      observedAt: "2026-09-01T10:00:00Z",
    },
    hours: { status: "in_sync", dirtyCount: 0, observedAt: null },
    menu: {
      status: "in_sync",
      dirtyCount: 0,
      observedAt: null,
      eligible: true,
    },
    photos: { count: 27, observedAt: null },
    booking: { count: 1, observedAt: null },
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("ListingOverview", () => {
  it("names the listing, its client and its health, and lists every area", () => {
    stub({ summary: summary() })
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Old Crown Girton" })
    ).toBeInTheDocument()
    expect(screen.getByText("Old Crown Group")).toBeInTheDocument()
    expect(screen.getAllByText("In sync").length).toBeGreaterThan(0)
    const areas = screen.getByRole("region", { name: "Areas" })
    for (const area of [
      "Business profile",
      "Opening hours",
      "Booking links",
      "Photos",
      "Posts",
      "Food menu",
      "People with access",
      "Verification",
    ]) {
      expect(
        within(areas).getByRole("heading", { level: 3, name: area })
      ).toBeInTheDocument()
    }
    expect(within(areas).getByText("27 of your photos")).toBeInTheDocument()
    expect(
      within(areas).getByRole("link", { name: "Edit Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    // Nothing to publish: no call to action in the header.
    expect(
      screen.queryByRole("link", { name: /Review & publish/ })
    ).not.toBeInTheDocument()
    // Two listings under this client: the switcher is offered.
    expect(
      screen.getByRole("combobox", {
        name: "Switch to another listing of this client",
      })
    ).toBeInTheDocument()
  })

  it("offers Review & publish when local edits are not on Google", () => {
    stub({
      summary: summary({
        profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.getByRole("link", { name: "Review & publish (2)" })
    ).toHaveAttribute("href", "/listings/l1/changes")
    expect(screen.getAllByText("Changes to publish").length).toBeGreaterThan(0)
    const areas = screen.getByRole("region", { name: "Areas" })
    expect(
      within(areas).getByText("2 fields not yet on Google")
    ).toBeInTheDocument()
  })

  it("hides the consoles from members and says why an area is unavailable", () => {
    stub({
      summary: summary(),
      caps: {
        canEditCanonical: false,
        canPublish: false,
        resources: {
          menu: {
            state: "unavailable",
            reasonCode: "google_location_not_linked",
          },
        },
      },
    })
    render(<ListingOverview locationId="l1" role="member" />)
    const areas = screen.getByRole("region", { name: "Areas" })
    expect(
      within(areas).queryByRole("heading", {
        level: 3,
        name: "People with access",
      })
    ).not.toBeInTheDocument()
    expect(
      within(areas).queryByRole("link", { name: "Edit Food menu" })
    ).not.toBeInTheDocument()
    const menu = within(areas).getByRole("heading", { level: 3, name: "Food menu" }).closest('[data-area="menu"]')
    expect(menu).not.toBeNull()
    expect(within(menu as HTMLElement).getByText("Unavailable")).toBeInTheDocument()
  })

  it("stays busy until the summary arrives", () => {
    stub({ summary: undefined })
    const { container } = render(
      <ListingOverview locationId="l1" role="owner" />
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})
