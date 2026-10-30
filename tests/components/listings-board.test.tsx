import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings",
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock("@/lib/navigation/shallow-url", () => ({
  replaceUrl: (href: string) => replace(href),
  pushUrl: (href: string) => push(href),
}))
// Completeness has its own query and tests; here it is simply not known.
vi.mock("@/lib/listings/completeness-query", () => ({
  useBoardCompleteness: () => ({ data: [], isPending: false }),
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
// The inline File under… control mounts a Select and the client mutations;
// its own behaviour is not what this board test is about.
vi.mock("@/components/listings/file-under-client", () => ({
  FileUnderClient: ({ locationName }: { locationName: string }) => (
    <button type="button">File {locationName} under…</button>
  ),
}))

import { ListingsBoard } from "@/components/listings/listings-board"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import * as clientsHook from "@/lib/queries/use-clients"
import * as summaryHook from "@/lib/queries/use-listing-summary"
import * as locationsHook from "@/lib/queries/use-locations"

function summary(
  overrides: Partial<ListingSummary> & { locationId: string }
): ListingSummary {
  return {
    ...emptyListingSummary({
      locationId: overrides.locationId,
      linked: true,
      verified: true,
    }),
    connection: {
      status: "active",
      reconnectRequired: false,
      googleEmail: "a@b.c",
    },
    profile: { status: "in_sync", dirtyCount: 0, observedAt: null },
    hours: { status: "in_sync", dirtyCount: 0, observedAt: null },
    menu: {
      status: "in_sync",
      dirtyCount: 0,
      observedAt: null,
      eligible: true,
    },
    ...overrides,
  }
}

function stub({
  entries,
  summaries,
}: {
  entries: locationsHook.DirectoryEntry[]
  summaries: ListingSummary[]
}) {
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: entries,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [
        { id: "c1", name: "Old Crown Group" },
        { id: "c2", name: "Harbour Kitchen" },
      ],
      unassignedLocationCount: 1,
    },
    isPending: false,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
    data: summaries,
    isPending: false,
  } as unknown as UseQueryResult<ListingSummary[]>)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  replace.mockClear()
  search = ""
  window.history.replaceState(null, "", "/")
})

const entries: locationsHook.DirectoryEntry[] = [
  {
    id: "l1",
    name: "Old Crown Girton",
    linked: true,
    verified: true,
    clientId: "c1",
    clientName: "Old Crown Group",
  },
  {
    id: "l2",
    name: "Harbour View",
    linked: true,
    verified: true,
    clientId: "c2",
    clientName: "Harbour Kitchen",
  },
  {
    id: "l3",
    name: "Pier Cafe",
    linked: true,
    verified: false,
    clientId: null,
    clientName: null,
  },
]

/** Opens the order chip's menu and picks an order. */
async function chooseOrder(
  user: ReturnType<typeof userEvent.setup>,
  name: "Worst first" | "By client"
) {
  await user.click(screen.getByRole("button", { name: /^Order listings:/ }))
  await user.click(await screen.findByRole("menuitemradio", { name }))
}

describe("ListingsBoard", () => {
  it("puts unfiled listings first and offers to file them", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    render(<ListingsBoard role="owner" />)
    // Row 0 is the header; group rows ("Not filed under a client · 1") carry
    // no link, so skip them to reach the first listing.
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .filter((row) => !row.hasAttribute("data-group"))
    expect(
      within(rows[0]).getByRole("link", { name: "Pier Cafe" })
    ).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole("button", { name: "File Pier Cafe under…" })
    ).toBeInTheDocument()
    expect(
      within(rows[0]).getByText("Pending verification")
    ).toBeInTheDocument()
  })

  it("says what is waiting on each listing from the summary", () => {
    stub({
      entries,
      summaries: [
        summary({
          locationId: "l1",
          profile: { status: "core_dirty", dirtyCount: 2, observedAt: null },
        }),
        summary({
          locationId: "l2",
          suggestions: { profile: 1, foodMenus: 0 },
        }),
        summary({ locationId: "l3" }),
      ],
    })
    render(<ListingsBoard role="owner" />)
    const crown = screen.getByRole("row", { name: /Old Crown Girton/ })
    expect(within(crown).getByText("2 changes to publish")).toBeInTheDocument()
    expect(within(crown).getByText("Changes to publish")).toBeInTheDocument()
    const harbour = screen.getByRole("row", { name: /Harbour View/ })
    expect(within(harbour).getByText("1 Google change")).toBeInTheDocument()
    expect(within(harbour).getByText("Needs attention")).toBeInTheDocument()
    expect(
      screen.getByText("1 needs attention · 1 has changes to publish")
    ).toBeInTheDocument()
  })

  it("filters by client chip and by health", async () => {
    stub({
      entries,
      summaries: [
        summary({
          locationId: "l1",
          profile: { status: "core_dirty", dirtyCount: 1, observedAt: null },
        }),
        summary({ locationId: "l2" }),
        summary({ locationId: "l3" }),
      ],
    })
    render(<ListingsBoard role="owner" />)
    await userEvent.click(
      screen.getByRole("button", { name: /Harbour Kitchen/ })
    )
    expect(
      screen.queryByRole("link", { name: "Old Crown Girton" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Harbour View" })
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: /Harbour Kitchen/ })
    )
    await userEvent.click(screen.getByRole("button", { name: /^To publish/ }))
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Harbour View" })
    ).not.toBeInTheDocument()
  })

  it("orders worst health first across clients, or groups by client", async () => {
    stub({
      entries,
      summaries: [
        summary({ locationId: "l1" }),
        summary({
          locationId: "l2",
          lastPublish: {
            at: "2026-09-01T10:00:00Z",
            status: "failed",
            area: "hours",
          },
        }),
        summary({ locationId: "l3", verified: true }),
      ],
    })
    render(<ListingsBoard role="owner" />)
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .filter((row) => !row.hasAttribute("data-group"))
        .map((row) => within(row).getAllByRole("link")[0]!.textContent)
    // Harbour View needs attention; Pier Cafe is unverified; Old Crown is fine.
    expect(names()).toEqual(["Harbour View", "Pier Cafe", "Old Crown Girton"])

    await chooseOrder(userEvent.setup(), "By client")
    expect(names()).toEqual(["Pier Cafe", "Harbour View", "Old Crown Girton"])
    expect(replace).toHaveBeenLastCalledWith("/listings?order=client")
  })

  it("follows the top-bar switcher when it changes the address", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const { rerender } = render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("link", { name: "Harbour View" })
    ).toBeInTheDocument()

    search = "clientId=c1"
    rerender(<ListingsBoard role="owner" />)
    expect(screen.queryByRole("link", { name: "Harbour View" })).toBeNull()
    expect(
      screen.getByRole("button", { name: /Old Crown Group/ })
    ).toHaveAttribute("aria-pressed", "true")

    search = ""
    rerender(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("link", { name: "Harbour View" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^All clients/ })
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps search, health and client in the URL and reads them back", async () => {
    search = "health=unpublished&clientId=c1&q=crown"
    // The board rewrites the address it is on, which the hook mock above
    // does not stand for.
    window.history.replaceState(null, "", `/listings?${search}`)
    stub({
      entries,
      summaries: [
        summary({
          locationId: "l1",
          profile: { status: "core_dirty", dirtyCount: 1, observedAt: null },
        }),
        summary({ locationId: "l2" }),
        summary({ locationId: "l3" }),
      ],
    })
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("searchbox", { name: "Search listings" })
    ).toHaveValue("crown")
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Harbour View" })).toBeNull()

    await userEvent.click(
      within(screen.getByRole("group", { name: "Filter by health" })).getByRole(
        "button",
        { name: /^All/ }
      )
    )
    expect(replace).toHaveBeenLastCalledWith("/listings?clientId=c1&q=crown")
  })

  it("rewrites the URL once a search pauses, not on every keystroke", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
      delay: 50,
    })
    render(<ListingsBoard role="owner" />)
    const box = screen.getByRole("searchbox", { name: "Search listings" })
    await user.type(box, "crown")
    // The rows follow each keystroke; the address waits.
    expect(screen.queryByRole("link", { name: "Harbour View" })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenLastCalledWith("/listings?q=crown")
  })

  it("carries a search still waiting into a filter written before it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ListingsBoard role="owner" />)
    await user.type(
      screen.getByRole("searchbox", { name: "Search listings" }),
      "crown"
    )
    await chooseOrder(user, "By client")
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenLastCalledWith("/listings?q=crown&order=client")
    vi.advanceTimersByTime(1_000)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("folds the order into one menu chip in the health strip, which writes the URL only on a pick", async () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const user = userEvent.setup()
    render(<ListingsBoard role="owner" />)
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    // The order is one chip in the health strip, not a row of its own.
    expect(
      screen.queryByRole("group", { name: "Order listings" })
    ).not.toBeInTheDocument()
    const order = screen.getByRole("button", {
      name: "Order listings: Worst first",
    })
    expect(order).not.toHaveAttribute("aria-pressed")
    expect(order.closest('[data-slot="filter-chip-strip"]')).toBe(
      screen
        .getByRole("group", { name: "Filter by health" })
        .closest('[data-slot="filter-chip-strip"]')
    )
    await user.click(order)
    expect(
      await screen.findByRole("menuitemradio", { name: "Worst first" })
    ).toBeChecked()
    expect(replace).not.toHaveBeenCalled()
    await user.click(screen.getByRole("menuitemradio", { name: "By client" }))
    expect(replace).toHaveBeenLastCalledWith("/listings?order=client")
    expect(
      screen.getByRole("button", { name: "Order listings: By client" })
    ).toBeInTheDocument()
  })

  it("opens the order menu from the keyboard, moves with arrows and writes the URL once on a pick", async () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const user = userEvent.setup()
    render(<ListingsBoard role="owner" />)
    const trigger = screen.getByRole("button", {
      name: "Order listings: Worst first",
    })
    trigger.focus()
    await user.keyboard("{Enter}")
    const worst = await screen.findByRole("menuitemradio", {
      name: "Worst first",
    })
    const byClient = screen.getByRole("menuitemradio", { name: "By client" })
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    // Moving through the options never rewrites the address.
    // The menu opens on the current order. Base UI moves that first focus
    // on the next animation frame (arrow keys move it at once), so wait for
    // it as for the focus returning to the trigger below.
    await waitFor(() => expect(worst).toHaveFocus())
    await user.keyboard("{ArrowDown}")
    expect(byClient).toHaveFocus()
    await user.keyboard("{ArrowUp}")
    expect(worst).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(byClient).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenLastCalledWith("/listings?order=client")
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )
    const after = screen.getByRole("button", {
      name: "Order listings: By client",
    })
    await waitFor(() => expect(after).toHaveFocus())
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("draws no health chip with nothing in it, except All and the one chosen", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const { unmount } = render(<ListingsBoard role="owner" />)
    const health = screen.getByRole("group", { name: "Filter by health" })
    // No summary says anything is wrong or waiting, and none is a confirmed
    // "In sync" yet: only Pier Cafe (unverified) lands in a bucket, so the
    // buckets with nothing in them are not drawn.
    for (const label of ["All", "Not linked"])
      expect(
        within(health).getByRole("button", { name: new RegExp(`^${label}`) })
      ).toBeInTheDocument()
    for (const label of ["Needs attention", "To publish", "In sync"])
      expect(
        within(health).queryByRole("button", {
          name: new RegExp(`^${label}`),
        })
      ).not.toBeInTheDocument()
    unmount()

    // A chosen chip stays, so it can be left, even with nothing in it.
    search = "health=attention"
    render(<ListingsBoard role="owner" />)
    const chosen = screen.getByRole("button", { name: "Needs attention, 0" })
    expect(chosen).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps Add listings from Google at the end of the list, for owners and admins only", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const { unmount } = render(<ListingsBoard role="admin" />)
    const add = screen.getByRole("link", { name: "Add listings from Google" })
    expect(add).toHaveAttribute("href", "/setup")
    expect(
      screen.getByRole("table").compareDocumentPosition(add) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    unmount()
    render(<ListingsBoard role="member" />)
    expect(
      screen.queryByRole("link", { name: "Add listings from Google" })
    ).not.toBeInTheDocument()
  })

  it("announces the count in a live region instead of drawing it", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    render(<ListingsBoard role="owner" />)
    const line = screen.getByText(/^3 listings/).closest("p")!
    expect(line).toHaveAttribute("aria-live", "polite")
    expect(line).toHaveClass("sr-only")
  })

  it("announces how many listings a search leaves, out of all", async () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    render(<ListingsBoard role="owner" />)
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search listings" }),
      "Harbour"
    )
    const line = screen.getByText(/^1 of 3 listings shown/).closest("p")!
    expect(line).toHaveAttribute("aria-live", "polite")
  })

  it("names the search and keeps it when the match is under another health", async () => {
    search = "health=healthy&q=Old Crown"
    window.history.replaceState(null, "", `/listings?${search}`)
    stub({
      entries,
      summaries: [
        summary({
          locationId: "l1",
          profile: { status: "core_dirty", dirtyCount: 1, observedAt: null },
        }),
        summary({ locationId: "l2" }),
        summary({ locationId: "l3" }),
      ],
    })
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByText("No listings match “Old Crown”")
    ).toBeInTheDocument()
    expect(
      screen.getByText("1 listing matches outside “In sync”.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear filters" })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Show 1 match" }))
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("searchbox", { name: "Search listings" })
    ).toHaveValue("Old Crown")
    // The button went with the empty state: focus lands on the search.
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search listings" })
      ).toHaveFocus()
    )
    expect(replace).toHaveBeenLastCalledWith("/listings?q=Old+Crown")
  })

  it("asks to check the spelling when the search matches nothing anywhere", async () => {
    search = "q=zzzz"
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    render(<ListingsBoard role="owner" />)
    expect(screen.getByText("No listings match “zzzz”")).toBeInTheDocument()
    expect(
      screen.getByText(/Check the spelling, or clear the search/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Show/ })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search listings" })
      ).toHaveFocus()
    )
  })

  it("names the client when a client with no listings leaves nothing", () => {
    search = "clientId=c3"
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    vi.spyOn(clientsHook, "useClients").mockReturnValue({
      data: {
        items: [
          { id: "c1", name: "Old Crown Group" },
          { id: "c2", name: "Harbour Kitchen" },
          { id: "c3", name: "Railway Arms" },
        ],
        unassignedLocationCount: 1,
      },
      isPending: false,
    } as unknown as ReturnType<typeof clientsHook.useClients>)
    render(<ListingsBoard role="owner" />)
    expect(screen.getByText("No listings match")).toBeInTheDocument()
    expect(
      screen.getByText("No listing is in “Railway Arms” right now.")
    ).toBeInTheDocument()
  })

  it("selects every listing shown from the table header's select-all bar, and docks the selection bar", async () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    const user = userEvent.setup()
    render(<ListingsBoard role="owner" bulkEnabled />)
    expect(
      screen.queryByRole("region", { name: "Bulk change selection" })
    ).not.toBeInTheDocument()
    // In the header's selection column, so record cards keep it as the
    // select-all bar above them (TableSelectAllLabel), named by its words.
    const all = within(screen.getByRole("table")).getByRole("checkbox", {
      name: "Select all shown (3)",
    })
    expect(all.closest("thead")).not.toBeNull()
    const words = document.querySelector('[data-slot="table-select-all-label"]')
    expect(words).toHaveTextContent(/^Select all shown \(3\)$/)
    expect(words).toHaveAttribute("aria-hidden")
    await user.click(all)
    const bar = screen.getByRole("region", { name: "Bulk change selection" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    expect(bar).toHaveTextContent("3 selected")
    expect(words).toHaveTextContent("Select all shown (3) · 3 selected")
    const link = within(bar).getByRole("link", { name: "Prepare bulk change" })
    expect(link.getAttribute("href")).toMatch(/^\/listings\/bulk\?ids=/)
    expect(
      new Set(link.getAttribute("href")!.split("=")[1]!.split(","))
    ).toEqual(new Set(["l1", "l2", "l3"]))
    await user.click(
      within(bar).getByRole("button", { name: "Clear selection" })
    )
    expect(
      screen.queryByRole("region", { name: "Bulk change selection" })
    ).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="action-bar-spacer"]')).toBeNull()
    // The bar took the focused button with it: focus returns to select-all.
    await waitFor(() => expect(all).toHaveFocus())
  })

  it("says how many selected listings are not shown or not linked to Google", async () => {
    const unlinked: locationsHook.DirectoryEntry[] = [
      ...entries,
      {
        id: "l4",
        name: "Station Inn",
        linked: false,
        verified: undefined,
        clientId: "c1",
        clientName: "Old Crown Group",
      },
    ]
    stub({
      entries: unlinked,
      summaries: [
        summary({
          locationId: "l1",
          profile: { status: "core_dirty", dirtyCount: 1, observedAt: null },
        }),
        summary({ locationId: "l2" }),
        summary({ locationId: "l3" }),
      ],
    })
    const user = userEvent.setup()
    render(<ListingsBoard role="owner" bulkEnabled />)
    await user.click(
      screen.getByRole("checkbox", { name: "Select all shown (4)" })
    )
    const bar = screen.getByRole("region", { name: "Bulk change selection" })
    expect(bar).toHaveTextContent(/^4 selected · 1 not linked to Google/)
    await user.click(screen.getByRole("button", { name: /^To publish/ }))
    expect(bar).toHaveTextContent(
      /4 selected · 3 not shown · 1 not linked to Google/
    )
  })

  it("tells a row checkbox switched off at the cap why", async () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      id: `m${index}`,
      name: `Listing ${String(index).padStart(2, "0")}`,
      linked: true,
      verified: true,
      clientId: "c1",
      clientName: "Old Crown Group",
    }))
    stub({ entries: many, summaries: [] })
    render(<ListingsBoard role="owner" bulkEnabled />)
    for (let index = 0; index < 50; index++)
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: `Select Listing ${String(index).padStart(2, "0")} for a bulk change`,
        })
      )
    const last = screen.getByRole("checkbox", {
      name: "Select Listing 50 for a bulk change",
    })
    expect(last).toHaveAttribute("aria-disabled", "true")
    expect(last).toHaveAccessibleDescription(
      // jsdom's name computation drops the space before the muted words.
      /50 selected ?\(the most one change can cover\)/
    )
    const ticked = screen.getByRole("checkbox", {
      name: "Select Listing 00 for a bulk change",
    })
    expect(ticked).not.toHaveAccessibleDescription(/the most/)
  })

  it("refuses to select all shown past 50 listings instead of trimming", () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      id: `m${index}`,
      name: `Listing ${index}`,
      linked: true,
      verified: true,
      clientId: "c1",
      clientName: "Old Crown Group",
    }))
    stub({ entries: many, summaries: [] })
    render(<ListingsBoard role="owner" bulkEnabled />)
    const all = screen.getByRole("checkbox", { name: "Select all shown (51)" })
    expect(all).toHaveAttribute("aria-disabled", "true")
    expect(all).toHaveAccessibleDescription(/at most 50 listings/)
    // The reason is on screen too, not only in the description.
    expect(screen.getByText(/at most 50 listings/)).toBeVisible()
  })

  it("says reviews were checked, not the whole listing", () => {
    stub({
      entries,
      summaries: entries.map((entry) =>
        summary({
          locationId: entry.id,
          freshness: {
            state: "up_to_date",
            reason: null,
            lastCheckedAt: new Date().toISOString(),
          },
        })
      ),
    })
    render(<ListingsBoard role="owner" />)
    expect(screen.getAllByText(/^Reviews checked/).length).toBe(3)
    expect(screen.queryByText(/nothing here asks Google/)).toBeNull()
  })

  it("keeps the filing control away from members", () => {
    stub({ entries, summaries: [] })
    render(<ListingsBoard role="member" />)
    expect(
      screen.queryByRole("button", { name: /File Pier Cafe/ })
    ).not.toBeInTheDocument()
    expect(screen.getByText("Not filed")).toBeInTheDocument()
  })

  it("offers setup when there are no listings at all", () => {
    stub({ entries: [], summaries: [] })
    render(<ListingsBoard role="owner" />)
    expect(screen.getByText("No listings yet")).toBeInTheDocument()
    const add = screen.getByRole("link", { name: /Add listings from Google/ })
    expect(add).toHaveAttribute("href", "/setup")
    // The same primary action as everywhere else on the board.
    expect(add).toHaveClass("bg-primary")
  })

  it("sends Add listings to the client the board is narrowed to, if it is one the session can see", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    for (const [query, href] of [
      ["clientId=c1", "/setup?client=c1"],
      ["clientId=__unfiled__", "/setup"],
      ["clientId=gone", "/setup"],
      ["", "/setup"],
    ] as const) {
      search = query
      const { unmount } = render(<ListingsBoard role="owner" />)
      expect(
        screen.getByRole("link", { name: "Add listings from Google" })
      ).toHaveAttribute("href", href)
      unmount()
    }
  })

  it("says the board failed to load and offers a retry, rather than a partial board", async () => {
    const refetch = vi.fn()
    vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
    vi.spyOn(clientsHook, "useClients").mockReturnValue({
      data: { items: [], unassignedLocationCount: 0 },
      isPending: false,
    } as unknown as ReturnType<typeof clientsHook.useClients>)
    vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as UseQueryResult<ListingSummary[]>)
    const { unmount } = render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("heading", { name: "We couldn’t load your listings" })
    ).toBeInTheDocument()
    // Announced, with the retry outside the alert so it reads what happened.
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t load your listings")
    expect(alert).not.toHaveTextContent("Try again")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }))
    expect(refetch).toHaveBeenCalled()
    unmount()

    // While it tries again, the button says so.
    vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: true,
      refetch,
    } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("button", { name: /Trying again/ })
    ).toHaveAttribute("aria-busy", "true")
  })

  it("offers Check again when the summaries fail, and says so on screen", async () => {
    stub({ entries, summaries: [] })
    const refetch = vi.fn()
    vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    } as unknown as UseQueryResult<ListingSummary[]>)
    render(<ListingsBoard role="owner" />)
    const line = screen
      .getByText(/We couldn’t check what is waiting on each listing/)
      .closest("p")!
    expect(line).not.toHaveClass("sr-only")
    expect(line).toHaveAttribute("aria-live", "polite")
    const again = screen.getByRole("button", { name: "Check again" })
    // Beside the line, not inside the live region.
    expect(line).not.toContainElement(again)
    await userEvent.click(again)
    expect(refetch).toHaveBeenCalled()
  })

  it("says a failed refresh still shows the last check", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
      data: entries.map((entry) => summary({ locationId: entry.id })),
      isPending: false,
      isError: true,
      isFetching: true,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<ListingSummary[]>)
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByText(
        /We couldn’t refresh what is waiting; this is the last check/
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn’t check what is waiting/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Checking again/ })
    ).toHaveAttribute("aria-busy", "true")
  })

  it("still offers Add listings from Google to owners and admins while loading or failed, and to no one else", () => {
    const directory = (state: { isPending: boolean; isError: boolean }) => {
      vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
        data: undefined,
        refetch: vi.fn(),
        ...state,
      } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
      vi.spyOn(clientsHook, "useClients").mockReturnValue({
        data: { items: [], unassignedLocationCount: 0 },
        isPending: false,
      } as unknown as ReturnType<typeof clientsHook.useClients>)
      vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
        data: undefined,
        isPending: true,
      } as unknown as UseQueryResult<ListingSummary[]>)
    }
    for (const state of [
      { isPending: true, isError: false },
      { isPending: false, isError: true },
    ]) {
      directory(state)
      for (const role of ["owner", "admin"]) {
        const { unmount } = render(<ListingsBoard role={role} />)
        expect(
          screen.getByRole("link", { name: "Add listings from Google" })
        ).toHaveAttribute("href", "/setup")
        unmount()
      }
      for (const role of ["member", "viewer", null]) {
        const { unmount } = render(<ListingsBoard role={role} />)
        expect(
          screen.queryByRole("link", { name: "Add listings from Google" })
        ).not.toBeInTheDocument()
        unmount()
      }
    }
  })

  it("keeps known row problems and stays neutral while summaries are loading", () => {
    stub({ entries, summaries: [] })
    vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as UseQueryResult<ListingSummary[]>)
    render(<ListingsBoard role="owner" />)
    expect(screen.getByText("Checking each listing…")).toBeInTheDocument()
    // "Not checked" would contradict "Checking each listing…": the pill
    // waits for the summaries instead.
    const crown = screen.getByRole("row", { name: /Old Crown Girton/ })
    expect(within(crown).queryByText("Not checked")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("table")).queryByText("Not checked")
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("table")).queryByText("In sync")
    ).not.toBeInTheDocument()
    const cafe = screen.getByRole("row", { name: /Pier Cafe/ })
    expect(within(cafe).getByText("Pending verification")).toBeInTheDocument()
  })

  it("says a listing is not checked once the summaries have loaded without it", () => {
    stub({ entries, summaries: [] })
    render(<ListingsBoard role="owner" />)
    expect(screen.queryByText("Checking each listing…")).not.toBeInTheDocument()
    const crown = screen.getByRole("row", { name: /Old Crown Girton/ })
    expect(within(crown).getByText("Not checked")).toBeInTheDocument()
  })

  describe("quick look from lg", () => {
    // The viewport, as the shell's matchMedia answers it.
    const stubWidth = (wide: boolean) =>
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: wide && query === "(min-width: 64rem)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }))
      )
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("opens a listing's areas beside the board on a plain click, and stops the navigation", async () => {
      stubWidth(true)
      stub({
        entries,
        summaries: entries.map((entry) => summary({ locationId: entry.id })),
      })
      render(<ListingsBoard role="owner" />)
      const link = screen.getByRole("link", { name: "Old Crown Girton" })
      // fireEvent returns false when the click's default was prevented.
      expect(fireEvent.click(link, { detail: 1 })).toBe(false)
      const dialog = await screen.findByRole("dialog", {
        name: "Old Crown Girton",
      })
      expect(dialog).toHaveAttribute("data-slot", "quick-look")
      expect(
        within(dialog).getByRole("heading", { name: "Areas" })
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole("link", { name: "Business profile" })
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole("link", { name: "Open listing" })
      ).toHaveAttribute("href", link.getAttribute("href"))
    })

    it("uses the overview's words for each area", async () => {
      stubWidth(true)
      const recent = new Date().toISOString()
      stub({
        entries,
        summaries: [
          summary({
            locationId: "l1",
            hours: {
              status: "in_sync",
              dirtyCount: 0,
              observedAt: recent,
              checkStatus: "checked",
              googleEmpty: true,
            },
          }),
          summary({
            locationId: "l2",
            connection: {
              status: "expired",
              reconnectRequired: true,
              googleEmail: "a@b.c",
            },
          }),
          summary({ locationId: "l3" }),
        ],
      })
      const { unmount } = render(<ListingsBoard role="owner" />)
      fireEvent.click(screen.getByRole("link", { name: "Old Crown Girton" }), {
        detail: 1,
      })
      const dialog = await screen.findByRole("dialog", {
        name: "Old Crown Girton",
      })
      expect(within(dialog).getByText("Needs attention")).toBeInTheDocument()
      expect(
        within(dialog).getByText(
          "Google shows no opening hours for this listing."
        )
      ).toBeInTheDocument()
      expect(within(dialog).getByText("No hours on Google")).toBeInTheDocument()
      expect(within(dialog).queryByText("In sync")).not.toBeInTheDocument()
      unmount()

      render(<ListingsBoard role="owner" />)
      fireEvent.click(screen.getByRole("link", { name: "Harbour View" }), {
        detail: 1,
      })
      const disconnected = await screen.findByRole("dialog", {
        name: "Harbour View",
      })
      expect(
        within(disconnected).getAllByText("Unknown — can’t reach Google").length
      ).toBeGreaterThan(0)
      expect(
        within(disconnected).queryByText("In sync")
      ).not.toBeInTheDocument()
    })

    it("says the listing could not be checked when the summaries failed", async () => {
      stubWidth(true)
      stub({ entries, summaries: [] })
      vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        isFetching: false,
        refetch: vi.fn(),
      } as unknown as UseQueryResult<ListingSummary[]>)
      render(<ListingsBoard role="owner" />)
      fireEvent.click(screen.getByRole("link", { name: "Old Crown Girton" }), {
        detail: 1,
      })
      const dialog = await screen.findByRole("dialog", {
        name: "Old Crown Girton",
      })
      expect(
        within(dialog).getByText(/We couldn’t check this listing just now/)
      ).toBeInTheDocument()
      expect(within(dialog).queryByText("Not checked")).not.toBeInTheDocument()
    })

    it("leaves Enter and a modifier click on the row link to open the listing", () => {
      stubWidth(true)
      stub({
        entries,
        summaries: entries.map((entry) => summary({ locationId: entry.id })),
      })
      render(<ListingsBoard role="owner" />)
      const link = screen.getByRole("link", { name: "Old Crown Girton" })
      expect(fireEvent.click(link, { detail: 0 })).toBe(true)
      expect(fireEvent.click(link, { detail: 1, ctrlKey: true })).toBe(true)
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("opens the listing, not the quick look, on a click on its name", () => {
      stubWidth(true)
      stub({
        entries,
        summaries: entries.map((entry) => summary({ locationId: entry.id })),
      })
      render(<ListingsBoard role="owner" />)
      // The name sits above the row's stretched target, so a click on it
      // lands on the name, not on the link's own box.
      const name = within(
        screen.getByRole("link", { name: "Old Crown Girton" })
      ).getByText("Old Crown Girton")
      expect(fireEvent.click(name, { detail: 1 })).toBe(true)
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("does not intercept the click below lg", () => {
      stubWidth(false)
      stub({
        entries,
        summaries: entries.map((entry) => summary({ locationId: entry.id })),
      })
      render(<ListingsBoard role="owner" />)
      const link = screen.getByRole("link", { name: "Old Crown Girton" })
      expect(fireEvent.click(link, { detail: 1 })).toBe(true)
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })
})
