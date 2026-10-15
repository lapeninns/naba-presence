import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/inbox" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { TabBar } from "@/components/app-shell/tab-bar"
import type { NavigationContext } from "@/lib/navigation/destinations"
import { queryKeys } from "@/lib/queries/keys"

beforeEach(() => {
  // Nothing here should reach the network: the counts come from the cache.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  pathname.current = "/inbox"
})

function renderTabBar({
  context = { role: "owner", mode: "agency" },
  scopeClientId = null,
  needsReply,
  unread,
  moreOpen = false,
  onOpenMore = vi.fn(),
}: {
  context?: NavigationContext
  scopeClientId?: string | null
  needsReply?: number
  unread?: number
  moreOpen?: boolean
  onOpenMore?: () => void
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (needsReply !== undefined) {
    client.setQueryData(queryKeys.reviewCounts("organisation"), {
      byQueue: { needs_reply: needsReply },
    })
  }
  if (unread !== undefined) {
    client.setQueryData(queryKeys.notifications("badge"), {
      unreadCount: unread,
    })
  }
  const view = render(
    <QueryClientProvider client={client}>
      <TabBar
        context={context}
        scopeClientId={scopeClientId}
        moreOpen={moreOpen}
        onOpenMore={onOpenMore}
      />
    </QueryClientProvider>
  )
  const bar = screen.getByRole("navigation", { name: "Primary" })
  return { ...view, bar, tabs: within(bar) }
}

describe("TabBar", () => {
  it("is the tab-bar chrome slot globals.css keys on", () => {
    const { bar } = renderTabBar()
    expect(bar).toHaveAttribute("data-slot", "tab-bar")
  })

  it("shows four labelled destinations and More for an agency", () => {
    const { tabs } = renderTabBar()
    const links = tabs.getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual([
      "Inbox",
      "Listings",
      "Clients",
      "Reports",
    ])
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/inbox",
      "/listings",
      "/clients",
      "/reports",
    ])
    // Labels are visible text, not tooltips.
    for (const label of ["Inbox", "Listings", "Clients", "Reports", "More"]) {
      expect(tabs.getByText(label)).toBeVisible()
    }
    expect(tabs.getByRole("button", { name: "More" })).toBeInTheDocument()
  })

  it("swaps Clients for Calendar in a business and never scopes a link", () => {
    const { tabs } = renderTabBar({
      context: { role: "owner", mode: "business" },
      scopeClientId: "c1",
    })
    expect(
      tabs.getAllByRole("link").map((link) => link.getAttribute("href"))
    ).toEqual(["/inbox", "/listings", "/calendar", "/reports"])
  })

  it("carries the agency's client in scope on Inbox, Listings and Reports", () => {
    const { tabs } = renderTabBar({ scopeClientId: "c2" })
    expect(
      tabs.getAllByRole("link").map((link) => link.getAttribute("href"))
    ).toEqual([
      "/inbox?clientId=c2",
      "/listings?clientId=c2",
      "/clients",
      "/reports?clientId=c2",
    ])
  })

  it("marks the current tab, including beneath it", () => {
    pathname.current = "/listings/l1/hours"
    const { tabs } = renderTabBar()
    const current = tabs
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent("Listings")
  })

  it("marks the tab Setup lives under", () => {
    pathname.current = "/setup"
    const agency = renderTabBar()
    expect(
      agency.tabs.getByRole("link", { name: "Clients" })
    ).toHaveAttribute("aria-current", "page")
    agency.unmount()
    const business = renderTabBar({
      context: { role: "owner", mode: "business" },
    }).tabs
    expect(
      business.getByRole("link", { name: "Listings" })
    ).toHaveAttribute("aria-current", "page")
  })

  it("puts the needs-reply count in the Inbox tab's name", () => {
    const { tabs } = renderTabBar({ needsReply: 2 })
    const inbox = tabs.getByRole("link", { name: "Inbox, 2 need a reply" })
    expect(inbox).toHaveAttribute("href", "/inbox")
    expect(inbox).toHaveAttribute("aria-current", "page")
  })

  it("says needs for one", () => {
    const { tabs } = renderTabBar({ needsReply: 1 })
    expect(
      tabs.getByRole("link", { name: "Inbox, 1 needs a reply" })
    ).toBeInTheDocument()
  })

  it("names the Inbox plainly with nothing waiting", () => {
    const { tabs } = renderTabBar({ needsReply: 0 })
    expect(tabs.getByRole("link", { name: "Inbox" })).toBeInTheDocument()
  })

  it("names a Notifications tab with the unread count", () => {
    const { tabs } = renderTabBar({
      context: { role: "owner", mode: "business", hideCalendar: true },
      unread: 3,
    })
    expect(
      tabs.getByRole("link", { name: "Notifications, 3 unread" })
    ).toHaveAttribute("href", "/notifications")
  })

  it("opens More as a dialog and reports it open", async () => {
    const onOpenMore = vi.fn()
    const { tabs, rerender } = renderTabBar({ onOpenMore })
    const more = tabs.getByRole("button", { name: "More" })
    expect(more).toHaveAttribute("aria-haspopup", "dialog")
    expect(more).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(more)
    expect(onOpenMore).toHaveBeenCalledTimes(1)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TabBar
          context={{ role: "owner", mode: "agency" }}
          scopeClientId={null}
          moreOpen
          onOpenMore={onOpenMore}
        />
      </QueryClientProvider>
    )
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
  })

  it("marks More as holding the current page on a More destination", () => {
    pathname.current = "/team"
    const { tabs } = renderTabBar()
    const more = tabs.getByRole("button", { name: "More" })
    expect(more).toHaveAccessibleDescription("Contains the current page")
    expect(more).toHaveAttribute("data-current", "true")
    expect(
      tabs
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
    ).toHaveLength(0)
  })

  it("carries the unread notifications on More when Notifications is not a tab", () => {
    const { tabs, container } = renderTabBar({ unread: 3 })
    // The name stays exactly "More"; the count is its description.
    const more = tabs.getByRole("button", { name: "More" })
    expect(more).toHaveAccessibleName("More")
    expect(more).toHaveAccessibleDescription("3 unread notifications")
    const badge = container.querySelector("[data-slot='more-count']")
    expect(badge).toHaveTextContent("3")
    expect(badge).toHaveAttribute("aria-hidden", "true")
    expect(more).toContainElement(badge as HTMLElement)
  })

  it("says notification for one and keeps the current-page description", () => {
    pathname.current = "/team"
    const { tabs } = renderTabBar({ unread: 1 })
    expect(
      tabs.getByRole("button", { name: "More" })
    ).toHaveAccessibleDescription(
      "1 unread notification Contains the current page"
    )
  })

  it("leaves More plain when Notifications has its own tab", () => {
    const { tabs, container } = renderTabBar({
      context: { role: "owner", mode: "business", hideCalendar: true },
      unread: 3,
    })
    expect(
      tabs.getByRole("button", { name: "More" })
    ).not.toHaveAccessibleDescription()
    expect(container.querySelector("[data-slot='more-count']")).toBeNull()
  })

  it("does not mark More on a tab's own page", () => {
    const { tabs } = renderTabBar()
    expect(
      tabs.getByRole("button", { name: "More" })
    ).not.toHaveAccessibleDescription()
  })
})
