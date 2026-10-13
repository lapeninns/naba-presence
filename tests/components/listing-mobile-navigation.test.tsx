import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

import { ListingAreaHeader } from "@/components/listings/area-frame"
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
}: {
  role?: string
  current?: "profile" | "hours"
  dirty?: boolean
  publishBlocked?: boolean
  summary?: ListingSummary
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
        status={null}
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
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
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
      screen.getByRole("button", { name: "Listing area: Opening hours" })
    ).toBeInTheDocument()
  })
  it("keeps admin areas hidden from members and explains unavailable areas", async () => {
    render(<Header role="member" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
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
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    await screen.findByRole("menuitem", { name: "Opening hours" })
    const menuHrefs = screen
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("href"))
    expect(menuHrefs).toEqual(tabHrefs)
    expect(menuHrefs.at(-1)).toBe("/listings/l1/changes")
    expect(
      tabs.querySelector('[href="/listings/l1/menu"]')
    ).toHaveAttribute("data-unavailable", "true")
  })
  // The desk's strip is the TabNav primitive, nothing hand-rolled on top:
  // the route's area is the one current link, an unavailable area stays a
  // followable link (not `disabled`), and counts are count badges.
  it("draws the desk's tab row with TabNav: one current link, counts in the count role", () => {
    const summary = {
      ...emptyListingSummary({ locationId: "l1", linked: true, verified: true }),
      menu: { status: "core_dirty", dirtyCount: 2, eligible: true },
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
    const publish = tabs.querySelector('[href="/listings/l1/changes"]')!
    expect(publish).toHaveTextContent("Review & publish")
    expect(publish).toHaveTextContent("2, 2 to publish")
    // The badge around the visible figure is a `count` badge.
    const figure = publish.querySelector("span[aria-hidden]")!
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
      screen.getByRole("button", { name: "Listing area: Business profile" })
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
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    const item = await screen.findByRole("menuitem", { name: /Opening hours/ })
    expect(item).not.toHaveAttribute("aria-disabled", "true")
    await userEvent.click(item)
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l1/hours")
  })
  it("opens Activity from the phone's overflow menu, fetching history only then", async () => {
    render(<Header />)
    expect(historyMounted).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole("button", { name: "More listing actions" })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Activity" })
    )
    expect(
      await screen.findByRole("dialog", { name: "Recent activity" })
    ).toBeInTheDocument()
    expect(historyMounted).toHaveBeenCalled()
  })
  it("keeps the model note reachable on an area behind an info button", async () => {
    render(<Header current="hours" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Where changes go" })
    )
    expect(
      (await screen.findAllByText(/nothing reaches Google until you review/))
        .length
    ).toBeGreaterThan(1)
  })
})
