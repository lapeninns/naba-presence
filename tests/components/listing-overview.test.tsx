import { render, screen, within } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1",
  notFound: vi.fn(),
}))
// The completeness card has its own test; it needs a toast provider and
// its own queries.
vi.mock("@/components/listings/completeness-card", () => ({
  CompletenessCard: () => <div data-testid="completeness-card" />,
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

import { ListingOverview } from "@/components/listings/listing-overview"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import * as capsHook from "@/lib/queries/use-location-capabilities"
import * as googleChangesHook from "@/lib/queries/use-google-change-watch"
import * as summaryHook from "@/lib/queries/use-listing-summary"
import * as locationsHook from "@/lib/queries/use-locations"

function stub({
  summary,
  caps,
  entry,
  googleChanges = [],
}: {
  summary: ListingSummary | undefined
  caps?: LocationCapabilities
  entry?: { linked?: boolean; clientId?: string | null }
  /** The statuses of the listing's changes made on Google. */
  googleChanges?: string[]
}) {
  vi.spyOn(googleChangesHook, "useGoogleChanges").mockReturnValue({
    data: { changes: googleChanges.map((status) => ({ status })) },
    isPending: false,
  } as unknown as ReturnType<typeof googleChangesHook.useGoogleChanges>)
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
        ...entry,
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
      screen.getByRole("heading", { level: 1, name: /^Old Crown Girton/ })
    ).toBeInTheDocument()
    expect(screen.getByText("Old Crown Group")).toBeInTheDocument()
    expect(screen.getAllByText("Not checked").length).toBeGreaterThan(0)
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
      within(areas).getByRole("link", { name: "Open Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    // Nothing to publish: no call to action in the header.
    expect(
      document.querySelector('[data-slot="review-publish-link"]')
    ).toBeNull()
    expect(
      screen.queryByRole("link", { name: /Review & publish \(/ })
    ).not.toBeInTheDocument()
    // Two listings under this client: the listing's name, the title, is the
    // switcher (DSK-06), a menu (no text field, so no keyboard on a phone).
    // The client stays as plain words above it.
    expect(screen.queryByRole("combobox")).toBeNull()
    const switcher = screen.getByRole("button", {
      name: /switch to another listing of this client/,
    })
    expect(switcher).not.toHaveTextContent("Old Crown Group")
    expect(switcher.closest("h1")).not.toBeNull()
    expect(screen.getByText("Old Crown Group")).toBeInTheDocument()
  })

  it("offers Review & publish when local edits are not on Google", () => {
    stub({
      summary: summary({
        profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    // The header's button from md, and the same link under the alerts for a
    // phone, whose header keeps it in the overflow menu.
    const links = screen.getAllByRole("link", { name: "Review & publish (2)" })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/listings/l1/changes")
    }
    expect(links[1]).toHaveClass("md:hidden")
    expect(screen.getAllByText("Changes to publish").length).toBeGreaterThan(0)
    const areas = screen.getByRole("region", { name: "Areas" })
    expect(
      within(areas).getByText("2 fields not yet on Google")
    ).toBeInTheDocument()
  })

  it("offers neither Review & publish link while Google can't be reached", () => {
    stub({
      summary: summary({
        connection: {
          status: "revoked",
          reconnectRequired: true,
          googleEmail: "owner@example.com",
        },
        profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.queryByRole("link", { name: /Review & publish \(/ })
    ).toBeNull()
  })

  it("tells a read-only role what the areas are for, and who can verify", () => {
    stub({
      summary: summary({ verified: false }),
      caps: { canEditCanonical: false, canPublish: false, resources: {} },
    })
    render(<ListingOverview locationId="l1" role="viewer" />)
    expect(
      screen.getByText("Open an area to see what it holds here and on Google.")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Check a problem, review changes or edit an area.")
    ).toBeNull()
    expect(
      screen.getByText(/An owner or admin can start verification\./)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Start verification" })
    ).toBeNull()
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
    const menu = within(areas)
      .getByRole("heading", { level: 3, name: "Food menu" })
      .closest('[data-area="menu"]')
    expect(menu).not.toBeNull()
    expect(
      within(menu as HTMLElement).getByText("Unavailable")
    ).toBeInTheDocument()
  })

  it("never claims In sync while Google can't be reached for the listing", () => {
    stub({
      summary: summary({
        freshness: {
          state: "action_needed",
          reason: "listing_access_lost",
          lastCheckedAt: "2026-09-01T10:00:00Z",
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    // The connection row says so; sync is each area card's own status.
    const google = screen.getByRole("region", { name: "Google" })
    expect(within(google).getByText("Access lost")).toBeInTheDocument()
    expect(within(google).queryByText("In sync")).toBeNull()
    const areas = screen.getByRole("region", { name: "Areas" })
    const profile = within(areas)
      .getByRole("heading", { level: 3, name: "Business profile" })
      .closest('[data-area="profile"]') as HTMLElement
    expect(
      within(profile).getByText("Unknown — can’t reach Google")
    ).toBeInTheDocument()
    expect(within(profile).queryByText(/Checked against Google/)).toBeNull()
  })

  it("links Open on Google to the listing's Maps link, and hides it without one", () => {
    stub({
      summary: summary({ mapsUrl: "https://maps.google.com/?cid=123" }),
    })
    const { unmount } = render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.getByRole("link", { name: /Open on Google/ })
    ).toHaveAttribute("href", "https://maps.google.com/?cid=123")
    unmount()

    stub({ summary: summary() })
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(screen.queryByRole("link", { name: /Open on Google/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Open on Google/ })).toBeNull()
  })

  it("names a failed publish by its area's label", () => {
    stub({
      summary: summary({
        lastPublish: {
          at: "2026-09-01T10:00:00Z",
          status: "failed",
          area: "menu",
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    const alert = document.querySelector('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveTextContent(/The last food menu publish failed/)
    // Present on load, so it is page content, not an interruption.
    expect(alert).not.toHaveAttribute("role")
    expect(alert).toHaveTextContent(
      /Activity, at the top of this page, has the attempt details/
    )
    // The Google row uses the same words, not the summary's key.
    expect(screen.getByRole("region", { name: "Google" })).toHaveTextContent(
      "The last food menu publish failed"
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("puts actionable areas before secondary health details", () => {
    stub({
      summary: summary({
        hours: {
          status: "google_dirty",
          dirtyCount: 0,
          observedAt: new Date().toISOString(),
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    const areas = screen.getByRole("region", { name: "Areas" })
    const google = screen.getByRole("region", { name: "Google" })
    expect(
      areas.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("shows the completeness score above the areas, near the top on a phone", () => {
    stub({ summary: summary() })
    render(<ListingOverview locationId="l1" role="owner" />)
    const areas = screen.getByRole("region", { name: "Areas" })
    const card = screen.getByTestId("completeness-card")
    expect(
      card.compareDocumentPosition(areas) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("keeps only the connection and last published under the areas, without repeating verification or sync", () => {
    stub({
      summary: summary({
        lastPublish: {
          at: new Date().toISOString(),
          status: "succeeded",
          area: "hours",
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    const google = screen.getByRole("region", { name: "Google" })
    const rows = within(google).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Google connection")
    expect(rows[0]).toHaveTextContent("Up to date")
    expect(rows[0]).toHaveTextContent("owner@example.com")
    expect(rows[1]).toHaveTextContent("Last published")
    expect(rows[1]).toHaveTextContent("Last change: opening hours")
    expect(within(google).queryByText("Verification")).toBeNull()
    expect(within(google).queryByText("Sync with Google")).toBeNull()
    expect(screen.queryByRole("region", { name: "Health" })).toBeNull()
  })

  it("shows the verification state to a viewer who has no Verification card while disconnected", () => {
    const disconnected = {
      connection: {
        status: "revoked" as const,
        reconnectRequired: true,
        googleEmail: "owner@example.com",
      },
      verified: false,
    }
    stub({ summary: summary(disconnected) })
    const { unmount } = render(
      <ListingOverview locationId="l1" role="viewer" />
    )
    const google = screen.getByRole("region", { name: "Google" })
    const rows = within(google).getAllByRole("listitem")
    expect(rows).toHaveLength(3)
    expect(rows[2]).toHaveTextContent("Verification")
    expect(rows[2]).toHaveTextContent("Not verified")
    unmount()

    // An owner has the Verification card, and a connected listing has the
    // alert: neither repeats it as a row.
    stub({ summary: summary(disconnected) })
    const owner = render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      within(screen.getByRole("region", { name: "Google" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(2)
    owner.unmount()
    stub({ summary: summary({ verified: false }) })
    render(<ListingOverview locationId="l1" role="viewer" />)
    expect(
      within(screen.getByRole("region", { name: "Google" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(2)
    expect(
      screen.getByText("Google hasn’t verified this listing")
    ).toBeVisible()
  })

  it("leads with the broken connection: Reconnect for owners and admins, who to ask for everyone else", () => {
    const revoked = summary({
      connection: {
        status: "revoked",
        reconnectRequired: true,
        googleEmail: "owner@example.com",
      },
    })
    stub({ summary: revoked })
    const { unmount } = render(<ListingOverview locationId="l1" role="owner" />)
    const alert = document.querySelector(
      '[data-slot="connection-alert"]'
    ) as HTMLElement
    expect(alert).toHaveTextContent("Google can’t be reached for this listing")
    expect(alert).toHaveTextContent(/saved changes are kept/)
    expect(alert).not.toHaveTextContent(/Ask an owner or admin/)
    // The only Reconnect, in the alert above the areas.
    expect(
      within(alert).getByRole("link", { name: "Reconnect Google" })
    ).toHaveAttribute("href", "/setup?client=c1&step=connect")
    expect(
      screen.getAllByRole("link", { name: "Reconnect Google" })
    ).toHaveLength(1)
    const areas = screen.getByRole("region", { name: "Areas" })
    expect(
      alert.compareDocumentPosition(areas) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    unmount()

    stub({ summary: revoked })
    render(<ListingOverview locationId="l1" role="member" />)
    expect(screen.queryByRole("link", { name: "Reconnect Google" })).toBeNull()
    expect(
      screen.getByText(/Ask an owner or admin to reconnect it\./)
    ).toBeInTheDocument()
  })

  it("says a listing isn't linked, with the way to link it for owners and admins", () => {
    const unlinked = emptyListingSummary({
      locationId: "l1",
      linked: false,
      verified: false,
    })
    stub({ summary: unlinked, entry: { linked: false } })
    const { unmount } = render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.getByText("This listing isn’t linked to Google")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Link to Google" })
    ).toHaveAttribute("href", "/setup?client=c1&step=locations")
    unmount()

    stub({ summary: unlinked, entry: { linked: false } })
    render(<ListingOverview locationId="l1" role="viewer" />)
    expect(
      screen.getByText("This listing isn’t linked to Google")
    ).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Link to Google" })).toBeNull()
    expect(
      screen.getByText(/An owner or admin can link it from Setup\./)
    ).toBeInTheDocument()
  })

  it("asks for a fresh comparison after a failed publish without denying partial success", () => {
    stub({
      summary: summary({
        lastPublish: {
          at: new Date().toISOString(),
          status: "failed",
          area: "profile",
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.queryByText(/Nothing from that attempt is on Google/)
    ).toBeNull()
    expect(
      screen.getByText(/Some changes may already be on Google/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Check business profile" })
    ).toHaveAttribute("href", "/listings/l1/profile")
  })

  it("provides a check action when the last publish outcome is unclear", () => {
    stub({
      summary: summary({
        lastPublish: {
          at: new Date().toISOString(),
          status: "ambiguous",
          area: "hours",
        },
      }),
    })
    render(<ListingOverview locationId="l1" role="member" />)
    expect(
      screen.getByText(/Google hasn’t confirmed the last opening hours publish/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Check opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
  })

  it("marks an area tab this listing can't use", () => {
    stub({
      summary: summary(),
      caps: {
        canEditCanonical: true,
        canPublish: true,
        resources: {
          menu: { state: "unavailable", reasonCode: "permission_denied" },
        },
      },
    })
    render(<ListingOverview locationId="l1" role="owner" />)
    const tabs = screen.getByRole("navigation", { name: "Listing areas" })
    const menu = within(tabs).getByRole("link", { name: /Food menu/ })
    expect(menu).toHaveAttribute("data-unavailable", "true")
    expect(menu).toHaveTextContent(/unavailable/)
  })

  it("stays busy until the summary arrives", () => {
    stub({ summary: undefined })
    const { container } = render(
      <ListingOverview locationId="l1" role="owner" />
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("shows what changed on Google beside the health pill, linking to Suggested updates", () => {
    stub({
      summary: summary(),
      googleChanges: ["open", "open", "accepted", "reverting"],
    })
    const { container } = render(
      <ListingOverview locationId="l1" role="member" />
    )
    const header = container.querySelector(
      '[data-slot="listing-area-header"]'
    ) as HTMLElement
    const badge = within(header).getByRole("link", {
      name: /^2 changed on Google/,
    })
    expect(badge).toHaveAttribute("href", "/listings/l1/suggestions")
    expect(badge).toHaveTextContent("2 changed on Google")
    // The health pill stays; the badge sits beside it.
    expect(within(header).getByText("Not checked")).toBeInTheDocument()
  })

  it("shows no Google badge when nothing is open, or for a listing that isn't linked", () => {
    stub({ summary: summary(), googleChanges: ["accepted"] })
    const { unmount } = render(<ListingOverview locationId="l1" role="owner" />)
    expect(screen.queryByText(/changed on Google/)).toBeNull()
    unmount()

    stub({
      summary: emptyListingSummary({
        locationId: "l1",
        linked: false,
        verified: false,
      }),
      entry: { linked: false },
      googleChanges: ["open"],
    })
    const watched = vi.mocked(googleChangesHook.useGoogleChanges)
    watched.mockClear()
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(screen.queryByText(/changed on Google/)).toBeNull()
    // Not even asked: an unlinked listing has nothing on Google to compare.
    expect(watched).not.toHaveBeenCalled()
  })

  it("keeps the Google badge when the summary could not be read", () => {
    stub({ summary: undefined, googleChanges: ["open"] })
    vi.spyOn(summaryHook, "useListingSummary").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<ListingSummary>)
    render(<ListingOverview locationId="l1" role="owner" />)
    expect(
      screen.getByRole("link", {
        name: /^1 changed on Google/,
      })
    ).toHaveAttribute("href", "/listings/l1/suggestions")
  })
})
