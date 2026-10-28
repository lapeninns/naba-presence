import { render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { AreaCards } from "@/components/listings/area-cards"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import type { LocationCapabilities } from "@/lib/locations/gating"

const summary = emptyListingSummary({
  locationId: "l1",
  linked: true,
  verified: true,
})
const caps = { canEditCanonical: true, canPublish: true, resources: {} }

function card(label: string) {
  return within(
    screen.getByRole("heading", { name: label }).closest("article")!
  )
}

describe("overview area actions", () => {
  it("offers checking for unknown states and administrative/provider libraries", () => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={undefined}
        summaryFailed
        caps={caps}
        canManageConsoles
      />
    )
    expect(
      card("Opening hours").getByRole("link", { name: "Open Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    expect(
      card("People with access").getByRole("link", {
        name: "Open People with access",
      })
    ).toBeInTheDocument()
  })
  it("distinguishes provider libraries from publications through this app", () => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={{
          ...summary,
          photos: { count: 27, observedAt: null },
          posts: { drafts: 0, failed: 0, awaitingApproval: 0, published: 3 },
        }}
        caps={caps}
        canManageConsoles
      />
    )
    expect(
      card("Photos").getByRole("link", { name: "Open Photos" })
    ).toBeInTheDocument()
    expect(
      card("Photos").getByText(/including uploads outside this app/)
    ).toBeInTheDocument()
    expect(
      card("Posts").getByRole("link", { name: "Open Posts" })
    ).toBeInTheDocument()
    expect(
      card("Posts").getByText(/including posts created outside this app/)
    ).toBeInTheDocument()
  })
  it("offers review for pending decisions and never adds hidden admin actions", () => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={{ ...summary, suggestions: { profile: 1, foodMenus: 0 } }}
        caps={caps}
        canManageConsoles={false}
      />
    )
    expect(
      card("Suggested updates").getByRole("link", {
        name: "Review Suggested updates",
      })
    ).toHaveAttribute("href", "/listings/l1/suggestions")
    expect(
      screen.queryByRole("heading", { name: "People with access" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Verification" })
    ).not.toBeInTheDocument()
  })
  it("offers a read-only role View, not Review, for an area with changes", () => {
    const blocked = {
      state: "blocked" as const,
      reasonCode: "publish_not_allowed",
    }
    const readOnlyRoles: LocationCapabilities[] = [
      // A viewer, or a member without publish rights.
      {
        canEditCanonical: false,
        canPublish: false,
        resources: { profile: blocked, hours: blocked },
      },
      // A member who may publish, but not change canonical data.
      { canEditCanonical: false, canPublish: true, resources: {} },
    ]
    for (const readOnlyCaps of readOnlyRoles) {
      const { unmount } = render(
        <AreaCards
          locationId="l1"
          linked
          summary={{
            ...summary,
            hours: { status: "core_dirty", dirtyCount: 2, observedAt: null },
            suggestions: { profile: 1, foodMenus: 0 },
          }}
          caps={readOnlyCaps}
          canManageConsoles={false}
        />
      )
      expect(
        card("Opening hours").getByRole("link", { name: "View Opening hours" })
      ).toHaveAttribute("href", "/listings/l1/hours")
      // The pill still says what is waiting.
      expect(
        card("Opening hours").getByText("2 changes not on Google")
      ).toBeVisible()
      expect(
        card("Suggested updates").getByRole("link", {
          name: "View Suggested updates",
        })
      ).toHaveAttribute("href", "/listings/l1/suggestions")
      expect(screen.queryByRole("link", { name: /^Review / })).toBeNull()
      unmount()
    }
  })
  it("puts a concrete failure ahead of ordinary cards and retains unavailable gates for read-only roles", () => {
    const { container } = render(
      <AreaCards
        locationId="l1"
        linked
        summary={{
          ...summary,
          posts: { drafts: 0, failed: 1, awaitingApproval: 0, published: 0 },
        }}
        caps={{
          canEditCanonical: false,
          canPublish: false,
          resources: {
            menu: {
              state: "unavailable",
              reasonCode: "google_location_not_linked",
            },
          },
        }}
        canManageConsoles={false}
      />
    )
    expect(container.querySelector("article")).toHaveAttribute(
      "data-area",
      "posts"
    )
    expect(card("Food menu").getByText("Unavailable")).toBeInTheDocument()
    expect(card("Food menu").queryByRole("link")).not.toBeInTheDocument()
  })
  it("makes an area with a way in one interactive card whose link is the card's", () => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={summary}
        caps={{
          ...caps,
          resources: {
            menu: {
              state: "unavailable",
              reasonCode: "google_location_not_linked",
            },
          },
        }}
        canManageConsoles={false}
      />
    )
    const hours = screen
      .getByRole("heading", { name: "Opening hours" })
      .closest("article")!
    // listings-content-18: the whole card is the target (Card interactive),
    // its one link the stretched CardLink.
    expect(hours).toHaveAttribute("data-interactive")
    const link = within(hours).getByRole("link")
    expect(link).toHaveAttribute("data-slot", "card-link")
    // The stretch covers the whole card at every width: the small button's
    // touch overhang (after:inset-y-…, desk:after:hidden) must not win the
    // class merge and shrink it to a band.
    const classes = link.className.split(/\s+/)
    expect(classes).toContain("after:inset-0")
    expect(classes).toContain("desk:after:block")
    expect(classes.filter((c) => /^after:inset-[xy]-/.test(c))).toEqual([])
    expect(classes).not.toContain("desk:after:hidden")
    // A blocked area has no way in, so it is not drawn as a target.
    const menu = screen
      .getByRole("heading", { name: "Food menu" })
      .closest("article")!
    expect(menu).not.toHaveAttribute("data-interactive")
    expect(menu).toHaveAttribute("data-surface", "sunken")
  })
  it.each([
    { checkStatus: "failed" as const, observedAt: new Date().toISOString() },
    { checkStatus: "checked" as const, observedAt: "2020-01-01T00:00:00.000Z" },
  ])("offers a new comparison for an in-sync snapshot with %j", (check) => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={{
          ...summary,
          hours: { status: "in_sync", dirtyCount: 0, ...check },
        }}
        caps={caps}
        canManageConsoles
      />
    )
    expect(
      card("Opening hours").getByRole("link", { name: "Open Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
  })
  it("offers viewing rather than editing when Google confirms menus are not offered", () => {
    render(
      <AreaCards
        locationId="l1"
        linked
        summary={{ ...summary, menu: { ...summary.menu, eligible: false } }}
        caps={caps}
        canManageConsoles
      />
    )
    expect(
      card("Food menu").getByRole("link", { name: "View Food menu" })
    ).toHaveAttribute("href", "/listings/l1/menu")
    expect(
      card("Food menu").queryByRole("link", { name: "Edit Food menu" })
    ).not.toBeInTheDocument()
  })
})
