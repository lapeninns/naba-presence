import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/listings" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { AppBar } from "@/components/app-shell/app-bar"
import { ClientScopeRoot } from "@/components/app-shell/client-context"
import {
  PageChrome,
  PageChromeProvider,
} from "@/components/app-shell/page-chrome"
import type { ClientSummary } from "@/lib/contracts/clients"
import { queryKeys } from "@/lib/queries/keys"
import * as clientsHook from "@/lib/queries/use-clients"
import * as locationsHook from "@/lib/queries/use-locations"
import type { WorkspaceMode } from "@/lib/workspace/terms"

// The phone app bar: leading, a labelled back control on a deep page
// (derived from the trail, or a page's <PageChrome back> override),
// otherwise the workspace's name; the echoed title with the view's count;
// trailing, at most two controls, the scope chip (agency, more than one
// client) being one of them.

function client(id: string, name: string): ClientSummary {
  return {
    id,
    name,
    slug: id,
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    locationCount: 1,
    linkedCount: 1,
    verifiedCount: 1,
    health: "healthy",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
    lastSyncAt: null,
  } as ClientSummary
}

let clientList: ClientSummary[] = []

beforeEach(() => {
  clientList = [client("c1", "Old Crown Group")]
  vi.spyOn(clientsHook, "useClients").mockImplementation(
    () =>
      ({
        data: { items: clientList, unassignedLocationCount: 0 },
        isPending: false,
      }) as unknown as ReturnType<typeof clientsHook.useClients>
  )
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: [
      {
        id: "l1",
        name: "Old Crown Girton",
        clientId: "c1",
        clientName: "Old Crown Group",
      },
    ],
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 }))
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pathname.current = "/listings"
})

function renderBar({
  mode = "agency",
  page,
  onOpenClientScope = vi.fn(),
  needsReply,
  awaitingMyApproval = 0,
  unread,
}: {
  mode?: WorkspaceMode
  page?: React.ReactNode
  onOpenClientScope?: () => void
  needsReply?: number
  awaitingMyApproval?: number
  unread?: number
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(queryKeys.session, {
    session: { role: "owner", workspaceMode: mode },
  })
  if (needsReply !== undefined) {
    queryClient.setQueryData(queryKeys.reviewCounts("organisation"), {
      byQueue: {
        needs_reply: needsReply,
        awaiting_my_approval: awaitingMyApproval,
      },
    })
  }
  if (unread !== undefined) {
    queryClient.setQueryData(queryKeys.notifications("badge"), {
      unreadCount: unread,
    })
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ClientScopeRoot rememberedClientId={null}>
        <PageChromeProvider>
          <AppBar
            mode={mode}
            organisationName="Lapen Inns Agency"
            sessionReady
            onOpenPalette={vi.fn()}
            onOpenClientScope={onOpenClientScope}
          />
          <main id="main">
            <h1>Page</h1>
            {page}
          </main>
        </PageChromeProvider>
      </ClientScopeRoot>
    </QueryClientProvider>
  )
  const bar = document.querySelector<HTMLElement>('[data-slot="app-bar"]')!
  return { bar, within: within(bar) }
}

describe("AppBar leading control", () => {
  it("shows a labelled back control on a deep page", async () => {
    pathname.current = "/listings/l1"
    const { within: bar } = renderBar()
    const back = await bar.findByRole("link", { name: "Back to Listings" })
    expect(back).toHaveAttribute("href", "/listings")
    // The visible label is the destination; "Back to" is for the name.
    expect(back).toHaveTextContent("Listings")
    expect(bar.queryByText("Lapen Inns Agency")).not.toBeInTheDocument()
  })

  it("names a listing area's parent listing by what it is, not its name", async () => {
    // The area's header row already carries the listing's name.
    pathname.current = "/listings/l1/hours"
    const { within: bar } = renderBar()
    const back = await bar.findByRole("link", { name: "Back to Listing" })
    expect(back).toHaveAttribute("href", "/listings/l1")
    expect(back).toHaveTextContent("Listing")
    expect(back).not.toHaveTextContent("Old Crown Girton")
    expect(back).toHaveAttribute("title", "Old Crown Girton")
  })

  it("names the workspace on a top-level page with nothing to switch", () => {
    const { within: bar } = renderBar()
    expect(bar.getByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(bar.queryByRole("link", { name: /^Back to/ })).toBeNull()
    expect(bar.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("puts the client chip in the trailing slot for an agency with more than one client", async () => {
    // F1 Notion Mail header: the scope trigger moved from leading to
    // trailing (the NM account avatar), so the workspace name now stays
    // leading beside it.
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const onOpenClientScope = vi.fn()
    const { bar, within: inBar } = renderBar({ onOpenClientScope })
    const chip = inBar.getByRole("button", { name: "Client: All clients" })
    expect(chip).toHaveAttribute("aria-haspopup", "dialog")
    await userEvent.click(chip)
    expect(onOpenClientScope).toHaveBeenCalledTimes(1)
    const actions = bar.querySelector('[data-slot="app-bar-actions"]')!
    expect(actions).toContainElement(chip)
    expect(actions.lastElementChild).toBe(chip)
    expect(inBar.getByText("Lapen Inns Agency")).toHaveAttribute(
      "data-slot",
      "workspace-name"
    )
  })

  it("never shows the client chip to a business", () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { within: bar } = renderBar({ mode: "business" })
    expect(bar.queryByRole("button", { name: /^Client:/ })).toBeNull()
    expect(bar.getByText("Lapen Inns Agency")).toBeInTheDocument()
  })

  it("leaves the palette button out on the Inbox, which has its own search", () => {
    pathname.current = "/inbox"
    const { within: bar } = renderBar()
    expect(bar.queryByRole("button", { name: /^Search/ })).toBeNull()
    expect(bar.getByRole("link", { name: "Notifications" })).toBeInTheDocument()
  })

  it("offers the palette button elsewhere", () => {
    const { within: bar } = renderBar()
    expect(
      bar.getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    ).toBeInTheDocument()
  })

  it("keeps the compact title out of the accessibility tree", () => {
    const { bar } = renderBar()
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    expect(title).toHaveAttribute("aria-hidden", "true")
    // The h1 is still on screen, so the bar repeats nothing yet.
    expect(title).toHaveAttribute("data-visible", "false")
  })
})

describe("PageChrome overrides", () => {
  it("replaces the derived back target", async () => {
    pathname.current = "/listings/l1/hours"
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=needs_reply", label: "Reviews" }}
        />
      ),
    })
    expect(
      await bar.findByRole("link", { name: "Back to Reviews" })
    ).toHaveAttribute("href", "/inbox?queue=needs_reply")
    expect(
      bar.queryByRole("link", { name: "Back to Old Crown Girton" })
    ).toBeNull()
  })

  it("adds a back control to a top-level path", async () => {
    pathname.current = "/inbox"
    const { within: bar } = renderBar({
      page: <PageChrome back={{ href: "/inbox", label: "Reviews" }} />,
    })
    expect(
      await bar.findByRole("link", { name: "Back to Reviews" })
    ).toBeInTheDocument()
  })

  it("runs the page's own back on a plain activation, and stays a link", async () => {
    // The Inbox's pushed review: "‹ Inbox" pops the entry it pushed and
    // refocuses the row, rather than pushing the list on top.
    pathname.current = "/inbox"
    const onBack = vi.fn()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=all", label: "Inbox" }}
          onBack={onBack}
        />
      ),
    })
    const link = await bar.findByRole("link", { name: "Back to Inbox" })
    expect(link).toHaveAttribute("href", "/inbox?queue=all")
    await userEvent.click(link)
    expect(onBack).toHaveBeenCalledOnce()
    link.focus()
    await userEvent.keyboard("{Enter}")
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it("leaves a modified click to the browser", async () => {
    // Cmd/Ctrl-click opens the list in a new tab; the page stays put.
    pathname.current = "/inbox"
    const onBack = vi.fn()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=all", label: "Inbox" }}
          onBack={onBack}
        />
      ),
    })
    const link = await bar.findByRole("link", { name: "Back to Inbox" })
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    })
    link.dispatchEvent(click)
    expect(onBack).not.toHaveBeenCalled()
  })

  it("calls the latest handler without re-registering the override", async () => {
    pathname.current = "/inbox"
    const first = vi.fn()
    const second = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(queryKeys.session, {
      session: { role: "owner", workspaceMode: "agency" },
    })
    const ui = (onBack: () => void) => (
      <QueryClientProvider client={queryClient}>
        <ClientScopeRoot rememberedClientId={null}>
          <PageChromeProvider>
            <AppBar
              mode="agency"
              organisationName="Lapen Inns Agency"
              sessionReady
              onOpenPalette={vi.fn()}
              onOpenClientScope={vi.fn()}
            />
            <PageChrome
              back={{ href: "/inbox?queue=all", label: "Inbox" }}
              onBack={onBack}
            />
          </PageChromeProvider>
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    const { rerender } = render(ui(first))
    rerender(ui(second))
    await userEvent.click(
      await screen.findByRole("link", { name: "Back to Inbox" })
    )
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("removes the back control with back={null}", async () => {
    pathname.current = "/listings/l1"
    const { within: bar } = renderBar({ page: <PageChrome back={null} /> })
    expect(await bar.findByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(bar.queryByRole("link", { name: /^Back to/ })).toBeNull()
  })

  it("lets the page shorten the compact title", async () => {
    const { bar } = renderBar({ page: <PageChrome title="Short" /> })
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    await screen.findByText("Short", {
      selector: '[data-slot="app-bar-title"]',
    })
    expect(title).toHaveTextContent("Short")
  })

  it("lifts its override when the page unmounts", async () => {
    pathname.current = "/listings/l1"
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(queryKeys.session, {
      session: { role: "owner", workspaceMode: "agency" },
    })
    const ui = (withOverride: boolean) => (
      <QueryClientProvider client={queryClient}>
        <ClientScopeRoot rememberedClientId={null}>
          <PageChromeProvider>
            <AppBar
              mode="agency"
              organisationName="Lapen Inns Agency"
              sessionReady
              onOpenPalette={vi.fn()}
              onOpenClientScope={vi.fn()}
            />
            {withOverride ? (
              <PageChrome back={{ href: "/inbox", label: "Reviews" }} />
            ) : null}
          </PageChromeProvider>
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    const { rerender } = render(ui(true))
    expect(
      await screen.findByRole("link", { name: "Back to Reviews" })
    ).toBeInTheDocument()
    rerender(ui(false))
    expect(
      await screen.findByRole("link", { name: "Back to Listings" })
    ).toBeInTheDocument()
  })
})

describe("AppBar view count", () => {
  it("follows the echoed title with the count a page registered", async () => {
    const { bar } = renderBar({
      page: <PageChrome title="Posts" count={7} countLabel="scheduled" />,
    })
    const count = await screen.findByText("7", {
      selector: '[data-slot="app-bar-count"]',
    })
    const heading = bar.querySelector('[data-slot="app-bar-heading"]')!
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    expect(title).toHaveTextContent("Posts")
    expect(heading).toContainElement(count)
    expect(title.nextElementSibling).toBe(count)
    // Muted and regular weight, so the title stays the title.
    expect(count.className).toContain("text-ink-muted")
    expect(count.className).toContain("font-normal")
    expect(count.className).toContain("tabular-nums")
    // Visual only, inside the aria-hidden echo.
    expect(heading).toHaveAttribute("aria-hidden", "true")
  })

  it("shows no count for zero", () => {
    const { bar } = renderBar({ page: <PageChrome count={0} /> })
    expect(bar.querySelector('[data-slot="app-bar-count"]')).toBeNull()
  })

  it("falls back to the needs-reply count on the Inbox", async () => {
    pathname.current = "/inbox"
    renderBar({ needsReply: 12 })
    expect(
      await screen.findByText("12", { selector: '[data-slot="app-bar-count"]' })
    ).toBeInTheDocument()
  })

  it("adds the replies awaiting this person's approval to the Inbox count (R03)", async () => {
    pathname.current = "/inbox"
    renderBar({ needsReply: 12, awaitingMyApproval: 3 })
    expect(
      await screen.findByText("15", { selector: '[data-slot="app-bar-count"]' })
    ).toBeInTheDocument()
  })

  it("prefers the page's count to the Inbox fallback", async () => {
    pathname.current = "/inbox"
    renderBar({ needsReply: 12, page: <PageChrome count={3} /> })
    expect(
      await screen.findByText("3", { selector: '[data-slot="app-bar-count"]' })
    ).toBeInTheDocument()
    expect(screen.queryByText("12")).toBeNull()
  })

  it("leaves the Inbox count off a pushed review", async () => {
    pathname.current = "/inbox"
    const { bar } = renderBar({
      needsReply: 12,
      page: <PageChrome back={{ href: "/inbox", label: "Inbox" }} />,
    })
    await screen.findByRole("link", { name: "Back to Inbox" })
    expect(bar.querySelector('[data-slot="app-bar-count"]')).toBeNull()
  })

  it("hides the Inbox count at zero", () => {
    pathname.current = "/inbox"
    const { bar } = renderBar({ needsReply: 0 })
    expect(bar.querySelector('[data-slot="app-bar-count"]')).toBeNull()
  })
})

describe("AppBar trailing slot", () => {
  function controls(bar: HTMLElement) {
    const actions = bar.querySelector('[data-slot="app-bar-actions"]')!
    return Array.from(actions.querySelectorAll("a, button"))
  }

  // The chrome contract's selector (globals.css): a bar docked to the bottom
  // anywhere on the page hides the tab bar.
  const DOCKED = "[body:has([data-docked=bottom])_&]"

  it("is search then the scope chip on a page with a scope switcher", () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { bar } = renderBar()
    const items = controls(bar)
    // Search, the bell held for the docked case, then the chip.
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAccessibleName(
      "Search clients, listings, pages and actions"
    )
    expect(items[2]).toHaveAccessibleName("Client: All clients")
    // At rest the bell moves into More: it is not displayed in the bar.
    expect(items[1]).toHaveAccessibleName("Notifications")
    expect(items[1].className.split(" ")).toContain("hidden")
    expect(items[2].className.split(" ")).not.toContain("hidden")
  })

  it("swaps the scope chip for the bell and its count while a bar is docked", async () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { bar } = renderBar({ unread: 4 })
    const bell = await screen.findByRole("link", {
      name: "Notifications, 4 unread",
    })
    const chip = screen.getByRole("button", { name: "Client: All clients" })
    expect(bar).toContainElement(bell)
    // Docked: the tab bar (and More's badge) steps aside, the bell shows in
    // the chip's place with its count, and the chip hides. Same selector as
    // the tab bar's, so nothing reads the dock in JS (hydration-safe).
    expect(bell.className.split(" ")).toContain(`${DOCKED}:grid`)
    expect(chip.className.split(" ")).toContain(`${DOCKED}:hidden`)
    expect(
      bell.querySelector('[data-slot="notifications-count"]')
    ).toHaveTextContent("4")
    // The search control is never swapped.
    expect(controls(bar)[0]).toHaveAccessibleName(
      "Search clients, listings, pages and actions"
    )
  })

  it("keeps the chip when docked on a page whose bell already shows", () => {
    pathname.current = "/inbox"
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { bar } = renderBar()
    const items = controls(bar)
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAccessibleName("Notifications")
    expect(items[1].className).not.toContain(DOCKED)
  })

  it("is notifications then the scope chip on the Inbox", () => {
    pathname.current = "/inbox"
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { bar } = renderBar()
    const items = controls(bar)
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAccessibleName("Notifications")
    expect(items[1]).toHaveAccessibleName("Client: All clients")
  })

  it("is search and notifications with nothing to switch", () => {
    const { bar } = renderBar()
    const items = controls(bar)
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAccessibleName(
      "Search clients, listings, pages and actions"
    )
    expect(items[1]).toHaveAccessibleName("Notifications")
  })

  it("is notifications alone on the Inbox with nothing to switch", () => {
    pathname.current = "/inbox"
    const { bar } = renderBar()
    const items = controls(bar)
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveAccessibleName("Notifications")
  })

  it("holds the slot blank, never the bell, while the clients load", () => {
    vi.spyOn(clientsHook, "useClients").mockImplementation(
      () =>
        ({ data: undefined, isPending: true }) as unknown as ReturnType<
          typeof clientsHook.useClients
        >
    )
    const { bar, within: inBar } = renderBar()
    // The bell would be swapped for the scope chip a moment later.
    expect(inBar.queryByRole("link", { name: /^Notifications/ })).toBeNull()
    expect(inBar.queryByRole("button", { name: /^Client:/ })).toBeNull()
    const pending = bar.querySelector('[data-slot="app-bar-scope-pending"]')
    expect(pending).toHaveAttribute("aria-hidden", "true")
    expect(pending).toHaveClass("size-11")
    expect(controls(bar)).toHaveLength(1)
  })

  it("holds the slot blank while a business's locations load", () => {
    vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
    const { bar, within: inBar } = renderBar({ mode: "business" })
    expect(inBar.queryByRole("link", { name: /^Notifications/ })).toBeNull()
    expect(
      bar.querySelector('[data-slot="app-bar-scope-pending"]')
    ).not.toBeNull()
  })

  it("holds nothing on the Inbox while loading: its bell is already there", () => {
    pathname.current = "/inbox"
    vi.spyOn(clientsHook, "useClients").mockImplementation(
      () =>
        ({ data: undefined, isPending: true }) as unknown as ReturnType<
          typeof clientsHook.useClients
        >
    )
    const { bar } = renderBar()
    expect(bar.querySelector('[data-slot="app-bar-scope-pending"]')).toBeNull()
    const items = controls(bar)
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveAccessibleName("Notifications")
  })

  it("never says Client to a business, on any page", () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    for (const path of ["/listings", "/inbox", "/listings/l1"]) {
      pathname.current = path
      const { bar } = renderBar({ mode: "business" })
      expect(bar.textContent ?? "").not.toMatch(/client/i)
      for (const control of controls(bar)) {
        expect(control.getAttribute("aria-label") ?? "").not.toMatch(/client/i)
      }
      expect(controls(bar).length).toBeLessThanOrEqual(2)
      document.body.innerHTML = ""
    }
  })
})

// The echoed title takes the h1's place once the h1 is under the bar. The
// bar watches it with an IntersectionObserver; jsdom has none, so these
// stand one in and report the h1 as scrolled away.
function stubScrolledHeading() {
  const observers: {
    callback: IntersectionObserverCallback
    elements: Element[]
  }[] = []
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: (typeof observers)[number]
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, elements: [] }
        observers.push(this.entry)
      }
      observe(element: Element) {
        this.entry.elements.push(element)
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    }
  )
  // Reports every watched element (or only those `only` accepts) as under
  // the bar (`bottom: 0`) or still below it.
  const report = (bottom: number, only?: (element: Element) => boolean) =>
    act(() => {
      for (const { callback, elements } of observers) {
        if (only && !elements.some(only)) continue
        callback(
          [{ boundingClientRect: { bottom } } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      }
    })
  return {
    scrollAway: () => report(0),
    /** Moves only the page header's actions under (or back below) the bar. */
    scrollActions: (away: boolean) =>
      report(
        away ? 0 : 500,
        (element) => element.getAttribute("data-slot") === "page-header-actions"
      ),
    /** Moves only the h1 under the bar. */
    scrollHeading: () => report(0, (element) => element.tagName === "H1"),
  }
}

describe("AppBar one title at a time", () => {
  it("shows the workspace name until the h1 scrolls away, then the page title", async () => {
    const heading = stubScrolledHeading()
    const { bar } = renderBar()
    const name = bar.querySelector('[data-slot="workspace-name"]')!
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    expect(name).toHaveAttribute("data-visible", "true")
    expect(name.className.split(" ")).toContain("visible")
    expect(title).toHaveAttribute("data-visible", "false")
    expect(title.parentElement!.className.split(" ")).toContain("invisible")

    heading.scrollAway()

    // Never both: the name fades out (and leaves the accessibility tree) as
    // the title fades in.
    await vi.waitFor(() =>
      expect(title).toHaveAttribute("data-visible", "true")
    )
    expect(title).toHaveTextContent("Page")
    expect(title.parentElement!.className.split(" ")).toContain("visible")
    expect(name).toHaveAttribute("data-visible", "false")
    expect(name.className.split(" ")).toContain("invisible")
  })

  it("stacks the name and the title in one cell instead of side by side", () => {
    const { bar } = renderBar()
    const name = bar.querySelector('[data-slot="workspace-name"]')!
    const heading = bar.querySelector('[data-slot="app-bar-heading"]')!
    expect(name.parentElement).toBe(heading.parentElement)
    for (const element of [name, heading]) {
      expect(element.className.split(" ")).toEqual(
        expect.arrayContaining(["col-start-1", "row-start-1"])
      )
    }
  })

  it("swaps without a transition under reduced motion", () => {
    const { bar } = renderBar()
    for (const slot of ["workspace-name", "app-bar-heading"]) {
      expect(
        bar.querySelector(`[data-slot="${slot}"]`)!.className.split(" ")
      ).toContain("motion-reduce:transition-none")
    }
  })

  it("keeps the full workspace name and title in title attributes", () => {
    const { bar } = renderBar({ page: <PageChrome title="Short" /> })
    expect(bar.querySelector('[data-slot="workspace-name"]')).toHaveAttribute(
      "title",
      "Lapen Inns Agency"
    )
    expect(bar.querySelector('[data-slot="app-bar-title"]')).toHaveAttribute(
      "title",
      "Short"
    )
  })

  it("has no workspace name beside a deep page's back control", async () => {
    pathname.current = "/listings/l1/hours"
    const { bar, within: inBar } = renderBar()
    await inBar.findByRole("link", { name: "Back to Listing" })
    expect(bar.querySelector('[data-slot="workspace-name"]')).toBeNull()
  })
})

describe("AppBar page action", () => {
  function Plus(props: { className?: string }) {
    return <svg data-testid="plus-icon" className={props.className} />
  }

  it("shows the page's action only once the h1 has scrolled away", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const onSelect = vi.fn()
    const { bar, within: inBar } = renderBar({
      page: (
        <PageChrome
          action={{ label: "Connect another account", icon: Plus, onSelect }}
        />
      ),
    })
    // The header's own button is on screen: the bar does not double it.
    expect(
      inBar.queryByRole("button", { name: "Connect another account" })
    ).toBeNull()

    heading.scrollAway()

    const action = await inBar.findByRole("button", {
      name: "Connect another account",
    })
    expect(action).toHaveAttribute("data-slot", "app-bar-action")
    // A 44px target, in front of search and the bell.
    expect(action.className.split(" ")).toEqual(
      expect.arrayContaining(["h-11", "w-11"])
    )
    const actions = bar.querySelector('[data-slot="app-bar-actions"]')!
    expect(actions.firstElementChild).toBe(action)
    expect(
      inBar.getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    ).toBeInTheDocument()
    expect(
      inBar.getByRole("link", { name: "Notifications" })
    ).toBeInTheDocument()

    await userEvent.setup().click(action)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("waits for the header's own button to scroll away, not just the h1", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const { bar, within: inBar } = renderBar({
      page: (
        <>
          <div data-slot="page-header-actions">
            <button type="button">Connect another account</button>
          </div>
          <PageChrome
            action={{
              label: "Connect another account",
              icon: Plus,
              onSelect: vi.fn(),
            }}
          />
        </>
      ),
    })
    const inHeader = () => bar.querySelector('[data-slot="app-bar-action"]')

    // The h1 is gone but the header button is still on screen: one control
    // with that name, never two.
    heading.scrollHeading()
    await vi.waitFor(() =>
      expect(bar.querySelector('[data-slot="app-bar-title"]')).toHaveAttribute(
        "data-visible",
        "true"
      )
    )
    expect(inHeader()).toBeNull()
    expect(
      inBar.queryByRole("button", { name: "Connect another account" })
    ).toBeNull()

    // The header button scrolls under the bar too: the bar takes over.
    heading.scrollActions(true)
    expect(
      await inBar.findByRole("button", { name: "Connect another account" })
    ).toBeInTheDocument()

    // And back: scrolling up hands it back to the header.
    heading.scrollActions(false)
    await vi.waitFor(() => expect(inHeader()).toBeNull())
  })

  it("stays focusable and is renamed while pending, and ignores presses", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const onSelect = vi.fn()
    const { within: inBar } = renderBar({
      page: (
        <PageChrome
          action={{
            label: "Connect another account",
            pendingLabel: "Opening Google…",
            icon: Plus,
            onSelect,
            pending: true,
          }}
        />
      ),
    })
    heading.scrollAway()
    const action = await inBar.findByRole("button", {
      name: "Opening Google…",
    })
    // aria-disabled, not disabled: focus is not dropped to the body.
    expect(action).not.toBeDisabled()
    expect(action).toHaveAttribute("aria-disabled", "true")
    expect(action).toHaveAttribute("aria-busy", "true")
    action.focus()
    expect(action).toHaveFocus()
    await userEvent.setup().click(action)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("draws the label as text when the action has no icon", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const { within: inBar } = renderBar({
      page: (
        <PageChrome
          action={{ label: "Connect another account", onSelect: vi.fn() }}
        />
      ),
    })
    heading.scrollAway()
    const action = await inBar.findByRole("button", {
      name: "Connect another account",
    })
    expect(action).toHaveTextContent("Connect another account")
  })

  it("makes the control a link when the action has an href", async () => {
    pathname.current = "/team"
    const heading = stubScrolledHeading()
    const { within: inBar } = renderBar({
      page: (
        <PageChrome
          action={{
            label: "Invite a teammate",
            icon: Plus,
            href: "/team/invite",
          }}
        />
      ),
    })
    heading.scrollAway()
    const link = await inBar.findByRole("link", { name: "Invite a teammate" })
    expect(link).toHaveAttribute("href", "/team/invite")
  })

  it("shows no action on a page that registered none", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const { bar } = renderBar()
    heading.scrollAway()
    await vi.waitFor(() =>
      expect(bar.querySelector('[data-slot="app-bar-title"]')).toHaveAttribute(
        "data-visible",
        "true"
      )
    )
    expect(bar.querySelector('[data-slot="app-bar-action"]')).toBeNull()
  })
})

describe("AppBar short back label", () => {
  it("shortens a listing area's back label from the start", async () => {
    pathname.current = "/listings/l1/hours"
    const heading = stubScrolledHeading()
    const { within: bar } = renderBar()

    // The visible word is the name's tail ("Back to Listing"), the full
    // label stays one hover or long-press away.
    const short = await bar.findByRole("link", { name: "Back to Listing" })
    expect(short).toHaveTextContent("Listing")
    expect(short).not.toHaveTextContent("Old Crown Girton")
    expect(short).toHaveAttribute("title", "Old Crown Girton")
    expect(short).toHaveAttribute("href", "/listings/l1")

    // Scrolling the title under the bar changes nothing for it.
    heading.scrollAway()
    expect(
      await bar.findByRole("link", { name: "Back to Listing" })
    ).toHaveTextContent("Listing")
  })

  it("says Listing on a listing area even when the name is short", async () => {
    vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
      data: [
        { id: "l1", name: "The Bell", clientId: "c1", clientName: "Bell" },
      ],
    } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
    pathname.current = "/listings/l1/photos"
    const { within: bar } = renderBar()
    const back = await bar.findByRole("link", { name: "Back to Listing" })
    expect(back).not.toHaveTextContent("The Bell")
    expect(back).toHaveAttribute("title", "The Bell")
  })

  it("keeps the full label on a listing area whose back goes elsewhere", async () => {
    pathname.current = "/listings/l1/hours"
    const heading = stubScrolledHeading()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          title="Opening hours"
          back={{ href: "/clients/c1", label: "Old Crown Group" }}
        />
      ),
    })
    expect(
      await bar.findByRole("link", { name: "Back to Old Crown Group" })
    ).toHaveTextContent("Old Crown Group")
    heading.scrollAway()
    expect(
      await bar.findByRole("link", { name: "Back to Client" })
    ).toHaveAttribute("title", "Old Crown Group")
  })

  it("keeps the full label until the title echo shows on other deep pages", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          title="Connections"
          back={{
            href: "/settings?tab=notifications",
            label: "Notification settings",
          }}
        />
      ),
    })
    const full = await bar.findByRole("link", {
      name: "Back to Notification settings",
    })
    expect(full).toHaveTextContent("Notification settings")

    heading.scrollAway()

    const short = await bar.findByRole("link", { name: "Back to Settings" })
    expect(short).toHaveTextContent("Settings")
    expect(short).not.toHaveTextContent("Notification")
    expect(short).toHaveAttribute("title", "Notification settings")
  })

  it("leaves a label that already fits", async () => {
    pathname.current = "/settings/connections"
    const heading = stubScrolledHeading()
    const { within: bar } = renderBar()
    await bar.findByRole("link", { name: "Back to Settings" })
    heading.scrollAway()
    expect(
      await bar.findByRole("link", { name: "Back to Settings" })
    ).toHaveTextContent("Settings")
  })
})

describe("AppBar organisation-wide pages", () => {
  function controls(bar: HTMLElement) {
    const actions = bar.querySelector('[data-slot="app-bar-actions"]')!
    return Array.from(actions.querySelectorAll("a, button"))
  }

  it.each(["/team", "/settings", "/settings/connections", "/notifications"])(
    "shows search and the bell, not the scope chip, on %s",
    (path) => {
      pathname.current = path
      clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
      const { bar, within: inBar } = renderBar()
      expect(inBar.queryByRole("button", { name: /^Client:/ })).toBeNull()
      const items = controls(bar)
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveAccessibleName(
        "Search clients, listings, pages and actions"
      )
      expect(items[1]).toHaveAccessibleName("Notifications")
      // The bell is in the bar, not held back for the docked case.
      expect(items[1].className.split(" ")).not.toContain("hidden")
    }
  )

  it("does not wait for the client list to decide where the bell is", () => {
    pathname.current = "/team"
    vi.spyOn(clientsHook, "useClients").mockImplementation(
      () =>
        ({ data: undefined, isPending: true }) as unknown as ReturnType<
          typeof clientsHook.useClients
        >
    )
    const { bar } = renderBar()
    expect(bar.querySelector('[data-slot="app-bar-scope-pending"]')).toBeNull()
    expect(controls(bar)).toHaveLength(2)
  })

  it("shows search and the bell to a business on Settings, too", () => {
    pathname.current = "/settings"
    const { bar, within: inBar } = renderBar({ mode: "business" })
    expect(inBar.queryByRole("button", { name: /^Location:/ })).toBeNull()
    expect(controls(bar)).toHaveLength(2)
  })

  it("still shows the chip on the pages that follow the scope", () => {
    for (const path of ["/inbox", "/listings", "/reports", "/clients"]) {
      pathname.current = path
      clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
      const { within: inBar } = renderBar()
      expect(
        inBar.getByRole("button", { name: "Client: All clients" })
      ).toBeInTheDocument()
      document.body.innerHTML = ""
    }
  })
})

describe("AppBar scope chip on a client's own page", () => {
  beforeEach(() => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
  })

  it("shows only the client's mark, with the name in its accessible name", () => {
    pathname.current = "/clients/c1"
    const { within: bar } = renderBar()
    const chip = bar.getByRole("button", { name: "Client: Old Crown Group" })
    // The mark (the avatar's initials), no name beside it.
    expect(chip).toHaveTextContent(/^OC$/)
    expect(chip.querySelector("span[title]")).toBeNull()
    expect(chip.className.split(" ")).toContain("px-1.5")
  })

  it("keeps the mark-only chip on the client's deeper pages", () => {
    pathname.current = "/clients/c1/settings"
    const { within: bar } = renderBar()
    const chip = bar.getByRole("button", { name: "Client: Old Crown Group" })
    expect(chip.querySelector("span[title]")).toBeNull()
  })

  it("shows the name on the pages that follow the scope, with the full value in title", () => {
    pathname.current = "/listings"
    const { within: bar } = renderBar()
    const chip = bar.getByRole("button", { name: "Client: All clients" })
    expect(chip).toHaveTextContent("All clients")
    expect(chip.querySelector("span[title]")).toHaveAttribute(
      "title",
      "All clients"
    )
  })

  it("drops the name on a deep page while its title is echoed", async () => {
    pathname.current = "/listings/l1/hours"
    const heading = stubScrolledHeading()
    const { within: bar } = renderBar()
    const chip = await bar.findByRole("button", { name: /^Client:/ })
    expect(chip.querySelector("span[title]")).not.toBeNull()

    heading.scrollAway()

    await vi.waitFor(() =>
      expect(
        bar
          .getByRole("button", { name: /^Client:/ })
          .querySelector("span[title]")
      ).toBeNull()
    )
  })
})
