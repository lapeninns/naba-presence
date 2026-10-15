import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const followed = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1/profile",
}))
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        followed(href)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))
const historyMounted = vi.hoisted(() => vi.fn())
vi.mock("@/components/locations/activity-panel", () => ({
  LocationActivityPanel: () => {
    historyMounted()
    return <p>history</p>
  },
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({ data: [] }),
}))

import {
  GoogleFreshness,
  GoogleFreshnessSlot,
} from "@/components/editors/google-freshness"
import { ListingAreaHeader } from "@/components/listings/area-frame"
import { StatusPill } from "@/components/ui/status-pill"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import { useLeaveGuard } from "@/lib/editors/use-leave-guard"
import type { DirectoryEntry } from "@/lib/queries/use-locations"

const entry = {
  id: "l1",
  name: "The very long venue name that should wrap without hiding navigation",
  linked: true,
} as DirectoryEntry
function Header({
  role = "owner",
  current = "profile",
  dirty = false,
  publishBlocked = false,
  summary,
  status = null,
}: {
  role?: string
  current?: "profile" | "hours" | "overview"
  dirty?: boolean
  publishBlocked?: boolean
  summary?: ListingSummary
  status?: React.ReactNode
}) {
  const leave = useLeaveGuard({ when: dirty })
  return (
    <>
      <ListingAreaHeader
        entry={entry}
        role={role}
        locationId="l1"
        current={current}
        summary={summary}
        caps={{
          canEditCanonical: true,
          canPublish: true,
          resources: {
            ...(publishBlocked
              ? {
                  hours: {
                    state: "blocked" as const,
                    reasonCode: "publish_not_allowed",
                  },
                }
              : {}),
            menu: {
              state: "unavailable",
              reasonCode: "google_location_not_linked",
            },
          },
        }}
        status={status}
      />
      {leave.open ? (
        <div role="dialog" aria-label="Leave without saving?">
          <button onClick={() => leave.onOpenChange(false)}>
            Keep editing
          </button>
          <button onClick={leave.onConfirm}>Leave and discard</button>
        </div>
      ) : null}
    </>
  )
}
afterEach(() => vi.clearAllMocks())

describe("mobile listing area navigation", () => {
  it("names the current area and reflects route updates without local selection drift", async () => {
    const view = render(<Header />)
    // The title is the switcher: the heading's name stays the area's name.
    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading).toHaveAccessibleName("Business profile")
    expect(heading.querySelector("button")).toHaveAttribute(
      "data-slot",
      "listing-area-selector"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Business profile" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    expect(
      screen.getByRole("menuitem", { name: "Business profile" })
    ).toHaveAttribute("aria-current", "page")
    await userEvent.keyboard("{Escape}")
    view.rerender(<Header current="hours" />)
    expect(
      screen.getByRole("button", { name: "Opening hours" })
    ).toBeInTheDocument()
  })
  it("keeps admin areas hidden from members and explains unavailable areas", async () => {
    render(<Header role="member" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Business profile" })
    )
    expect(
      screen.queryByRole("menuitem", { name: /People with access/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: /Verification/ })
    ).not.toBeInTheDocument()
    // Muted with its reason, the same as the desk's tab row, and still a
    // link: a read-only look is allowed.
    const menu = await screen.findByRole("menuitem", { name: /Food menu/ })
    expect(menu).not.toHaveAttribute("aria-disabled", "true")
    expect(menu).toHaveAttribute("data-unavailable", "true")
    expect(menu).toHaveTextContent(/Unavailable/)
    expect(menu).toHaveAttribute("href", "/listings/l1/menu")
  })
  it("lists the same pages, in the same order, as the desk's tab row, Review & publish last", async () => {
    render(<Header />)
    const tabs = screen.getByRole("navigation", { name: "Listing areas" })
    const tabHrefs = Array.from(tabs.querySelectorAll("a")).map((link) =>
      link.getAttribute("href")
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Business profile" })
    )
    await screen.findByRole("menuitem", { name: "Opening hours" })
    const menuHrefs = screen
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("href"))
    // Review & publish is a header action on the desk, not a tab that can
    // fall off the strip's end (DSK-01); the area list keeps it last.
    expect(menuHrefs).toEqual([...tabHrefs, "/listings/l1/changes"])
    expect(tabs.querySelector('[href="/listings/l1/changes"]')).toBeNull()
    expect(tabs.querySelector('[href="/listings/l1/menu"]')).toHaveAttribute(
      "data-unavailable",
      "true"
    )
  })
  // The desk's strip is the TabNav primitive, nothing hand-rolled on top:
  // the route's area is the one current link, an unavailable area stays a
  // followable link (not `disabled`), and counts are count badges.
  it("draws the desk's tab row with TabNav: one current link, counts in the count role", () => {
    const summary = {
      ...emptyListingSummary({
        locationId: "l1",
        linked: true,
        verified: true,
      }),
      menu: { status: "core_dirty", dirtyCount: 2, eligible: true },
      suggestions: { profile: 2, foodMenus: 0 },
    } as ListingSummary
    const view = render(<Header summary={summary} />)
    const tabs = screen.getByRole("navigation", { name: "Listing areas" })
    expect(tabs).toHaveAttribute("data-slot", "listing-area-tabs")
    const current = tabs.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute("href", "/listings/l1/profile")
    const menu = tabs.querySelector('[href="/listings/l1/menu"]')!
    expect(menu).not.toHaveAttribute("aria-disabled")
    expect(menu).toHaveAttribute("data-unavailable", "true")
    const waiting = tabs.querySelector('[href="/listings/l1/suggestions"]')!
    expect(waiting).toHaveTextContent("2, 2 waiting")
    // Review & publish is always a header button with its count.
    expect(
      document.querySelector('[data-slot="review-publish-link"]')
    ).toHaveTextContent("Review & publish (2)")
    // The badge around the visible figure is a `count` badge.
    const figure = waiting.querySelector("span[aria-hidden]")!
    expect(figure).toHaveTextContent(/^2$/)
    expect(figure.parentElement).toHaveClass("text-count")
    expect(figure.parentElement!.className).not.toMatch(/text-caption/)
    view.rerender(<Header summary={summary} current="hours" />)
    expect(tabs.querySelector('[aria-current="page"]')).toHaveAttribute(
      "href",
      "/listings/l1/hours"
    )
  })

  it("keeps the existing dirty guard on menu links, including cancel and confirm", async () => {
    render(<Header dirty />)
    await userEvent.click(
      screen.getByRole("button", { name: "Business profile" })
    )
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    )
    expect(followed).not.toHaveBeenCalled()
    expect(
      screen.getByRole("dialog", { name: "Leave without saving?" })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Leave and discard" }))
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l1/hours")
  })
  it("keeps a readable area reachable when publishing is blocked for the role", async () => {
    render(<Header role="viewer" publishBlocked />)
    await userEvent.click(
      screen.getByRole("button", { name: "Business profile" })
    )
    const item = await screen.findByRole("menuitem", { name: /Opening hours/ })
    expect(item).not.toHaveAttribute("aria-disabled", "true")
    await userEvent.click(item)
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l1/hours")
  })
  it("opens Activity straight from the phone's header when it is the only action", async () => {
    render(<Header />)
    expect(
      screen.queryByRole("button", { name: "More listing actions" })
    ).not.toBeInTheDocument()
    expect(historyMounted).not.toHaveBeenCalled()
    await userEvent.click(
      document.querySelector<HTMLElement>(
        '[data-slot="listing-header-activity"]'
      )!
    )
    expect(
      await screen.findByRole("dialog", { name: "Recent activity" })
    ).toBeInTheDocument()
    expect(historyMounted).toHaveBeenCalled()
  })
  it("opens Activity from the phone's overflow menu, fetching history only then", async () => {
    const summary = {
      ...emptyListingSummary({
        locationId: "l1",
        linked: true,
        verified: true,
      }),
      menu: { status: "core_dirty", dirtyCount: 2, eligible: true },
    } as ListingSummary
    render(<Header summary={summary} />)
    expect(historyMounted).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole("button", { name: "More listing actions" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Review & publish (2)" })
    ).toHaveAttribute("href", "/listings/l1/changes")
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Activity" })
    )
    expect(
      await screen.findByRole("dialog", { name: "Recent activity" })
    ).toBeInTheDocument()
    expect(historyMounted).toHaveBeenCalled()
  })
  it("keeps the model note reachable on an area behind an info button without a pill", async () => {
    render(<Header current="hours" />)
    await userEvent.click(
      screen.getByRole("button", { name: "How changes reach Google" })
    )
    expect(
      (await screen.findAllByText(/nothing reaches Google until you review/))
        .length
    ).toBeGreaterThan(1)
  })
  it("opens the model note and the last Google check from the status pill", async () => {
    const refresh = vi.fn()
    render(
      <GoogleFreshnessSlot>
        <Header
          current="hours"
          status={<StatusPill tone="healthy">In sync</StatusPill>}
        />
        <GoogleFreshness
          observedAt={new Date().toISOString()}
          refreshing={false}
          onRefresh={refresh}
        />
      </GoogleFreshnessSlot>
    )
    // One line under the tabs on wider screens: the note, then the check.
    const meta = document.querySelector('[data-slot="listing-area-meta"]')!
    expect(meta).toHaveTextContent(/nothing reaches Google until you review/)
    expect(meta).toHaveTextContent(/Checked with Google just now/)
    // The editor draws no row of its own inside the slot.
    expect(
      screen.getAllByRole("button", { name: /Check Google now/ })
    ).toHaveLength(1)
    await userEvent.click(
      screen.getByRole("button", {
        name: "In sync, how changes reach Google",
      })
    )
    expect(
      (await screen.findAllByText(/nothing reaches Google until you review/))
        .length
    ).toBe(2)
    const checks = screen.getAllByRole("button", { name: /Check Google now/ })
    expect(checks).toHaveLength(2)
    await userEvent.click(checks[1]!)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it("shows a failed Google check in the header, and drops the line when the editor leaves", () => {
    const view = render(
      <GoogleFreshnessSlot>
        <Header current="hours" />
        <GoogleFreshness
          observedAt={new Date().toISOString()}
          refreshing={false}
          failed
          onRefresh={() => {}}
        />
      </GoogleFreshnessSlot>
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Google couldn’t be checked just now. Try again."
    )
    view.rerender(
      <GoogleFreshnessSlot>
        <Header current="hours" />
      </GoogleFreshnessSlot>
    )
    expect(screen.queryByRole("status")).toBeNull()
    expect(
      document.querySelector('[data-slot="listing-area-meta"]')
    ).not.toHaveTextContent(/Checked with Google/)
  })
  it("makes the listing's name the switcher on the overview, under the client in plain words", () => {
    render(<Header current="overview" />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      entry.name
    )
    expect(
      document.querySelector('[data-slot="listing-area-selector"]')
    ).toBeNull()
  })
})
