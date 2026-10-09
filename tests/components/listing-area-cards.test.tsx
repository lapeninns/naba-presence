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
      card("Opening hours").getByRole("link", { name: "Check Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    expect(
      card("People with access").getByRole("link", {
        name: "Check People with access",
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
      card("Photos").getByRole("link", { name: "Check Photos" })
    ).toBeInTheDocument()
    expect(
      card("Photos").getByText(/including uploads outside this app/)
    ).toBeInTheDocument()
    expect(
      card("Posts").getByRole("link", { name: "Check Posts" })
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
      card("Opening hours").getByRole("link", { name: "Check Opening hours" })
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
