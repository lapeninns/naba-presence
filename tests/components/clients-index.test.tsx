import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/clients",
  useSearchParams: () => search,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ClientsIndex, movedNotice } from "@/components/clients/clients-index"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"
import type { ClientSummary } from "@/lib/contracts/clients"

const base: ClientSummary = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 3,
  linkedCount: 3,
  verifiedCount: 2,
  health: "healthy",
  connections: [],
  openWork: { needsReply: 2, awaitingApproval: 0, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 3, notStarted: 0 },
  lastSyncAt: "2026-09-03T10:00:00.000Z",
}

function stub(items: ClientSummary[], unassignedLocationCount = 0) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items, unassignedLocationCount }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
  replace.mockReset()
  search = new URLSearchParams()
})

const renderIndex = (role = "owner") =>
  render(
    <QueryProvider>
      <ClientsIndex role={role} />
    </QueryProvider>
  )

describe("ClientsIndex", () => {
  it("orders by open work within a health state, not alphabetically", async () => {
    // An agency opens this to answer "where do I go now". A name-sorted list
    // makes them read every row to find the two that matter.
    stub([
      {
        ...base,
        id: "a",
        name: "Aardvark Cafe",
        openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
      },
      {
        ...base,
        id: "z",
        name: "Zebra Bistro",
        openWork: { needsReply: 9, awaitingApproval: 1, failed: 0 },
      },
    ])
    renderIndex()
    const links = await screen.findAllByRole("link", { name: /Cafe|Bistro/ })
    expect(links[0]).toHaveTextContent("Zebra Bistro")
  })

  it("gives each client's name link a full touch height on a phone", async () => {
    stub([{ ...base, id: "a", name: "Aardvark Cafe" }])
    renderIndex()
    const link = await screen.findByRole("link", { name: "Aardvark Cafe" })
    // The record card's way in: a 44px row on touch, a text link at the desk.
    expect(link).toHaveClass("min-h-(--np-touch)", "desk:min-h-0")
  })

  it("shows health as a word beside every client", async () => {
    stub([{ ...base, health: "disconnected" }])
    renderIndex()
    // The word is in the row, not only in the filter and summary tiles.
    const table = await screen.findByRole("table", {
      name: "Clients, with their Google health and open review work",
    })
    expect(within(table).getByText("Action needed")).toBeInTheDocument()
  })

  it("surfaces unassigned locations rather than hiding them", async () => {
    stub([base], 2)
    renderIndex()
    expect(
      await screen.findByText("2 listings have no client")
    ).toBeInTheDocument()
  })

  it("invites an owner to create the first client", async () => {
    stub([])
    renderIndex("owner")
    expect(
      await screen.findByText("Set up your first client")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New client" })).toHaveAttribute(
      "href",
      "/clients/new"
    )
  })

  it("tells a member who to ask instead of offering a button they cannot use", async () => {
    stub([])
    renderIndex("member")
    expect(
      await screen.findByText("No clients shared with you yet")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "New client" })
    ).not.toBeInTheDocument()
  })

  it("names the table so several on a page stay distinguishable", async () => {
    stub([base])
    renderIndex()
    await waitFor(() =>
      expect(
        screen.getByRole("table", {
          name: "Clients, with their Google health and open review work",
        })
      ).toBeInTheDocument()
    )
  })

  it("counts all seven health buckets in one chip strip, and a chip filters to exactly those", async () => {
    stub([
      { ...base, id: "a", name: "A", health: "disconnected" },
      { ...base, id: "b", name: "B", health: "attention" },
      { ...base, id: "c", name: "C", health: "syncing" },
      { ...base, id: "d", name: "D", health: "healthy" },
      { ...base, id: "e", name: "E", health: "unchecked" },
      { ...base, id: "f", name: "F", health: "partially_checked" },
      { ...base, id: "g", name: "G", health: "unpublished" },
      { ...base, id: "h", name: "H", health: "not_connected" },
    ])
    renderIndex()
    const strip = await screen.findByRole("group", { name: "Filter by health" })
    const chips = within(strip).getAllByRole("button")
    // "All" plus every bucket; no bucket is left out of the counts.
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "All 8",
      "Action needed 1",
      "Needs attention 1",
      "In sync 2",
      "Not checked 1",
      "Some listings not checked yet 1",
      "Changes to publish 1",
      "Not set up 1",
    ])
    expect(chips[0]).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(chips[1])
    expect(replace).toHaveBeenCalledWith("/clients?health=disconnected", {
      scroll: false,
    })
  })

  it("draws only the health buckets that have clients, with All first", async () => {
    stub([
      { ...base, id: "a", name: "A", health: "partially_checked" },
      { ...base, id: "b", name: "B", health: "healthy" },
    ])
    renderIndex()
    const strip = await screen.findByRole("group", { name: "Filter by health" })
    // No "Action needed 0" or "Needs attention 0" ahead of the one that
    // matters, and nothing past the edge of the strip to scroll to.
    expect(
      within(strip)
        .getAllByRole("button")
        .map((chip) => chip.textContent)
    ).toEqual(["All 2", "In sync 1", "Some listings not checked yet 1"])
  })

  it("keeps an empty bucket's chip while it is the chosen filter", async () => {
    search = new URLSearchParams("health=disconnected")
    stub([{ ...base, id: "a", name: "A", health: "healthy" }])
    renderIndex()
    const strip = await screen.findByRole("group", { name: "Filter by health" })
    const chosen = within(strip).getByRole("button", { pressed: true })
    // Zero draws no figure, but the name still says it.
    expect(chosen).toHaveAccessibleName("Action needed, 0")
    expect(chosen).toHaveTextContent(/^Action needed$/)
    fireEvent.click(chosen)
    expect(replace).toHaveBeenCalledWith("/clients", { scroll: false })
  })

  it("wraps the chips from md and puts search on a row of its own", async () => {
    stub([base])
    renderIndex()
    const strip = await screen.findByRole("group", { name: "Filter by health" })
    expect(strip).toHaveClass("md:flex-wrap")
    const search = screen.getByRole("search")
    // The chips are not inside the search row, and the pair stack at every
    // width (no `md:flex-row`), so 1280px never clips a chip.
    expect(search.contains(strip)).toBe(false)
    expect(search.parentElement).toBe(strip.parentElement)
    expect(search.parentElement).not.toHaveClass("md:flex-row")
  })

  it("says a client has never synced in words", async () => {
    stub([{ ...base, lastSyncAt: null }])
    renderIndex()
    expect(await screen.findByText("Not synced yet")).toBeInTheDocument()
    expect(screen.queryByText("Not yet")).not.toBeInTheDocument()
  })

  it("never shows a card whose health contradicts the chosen chip's count", async () => {
    // The old tiles said 0/0/0/0 beside a client marked as partly checked.
    search = new URLSearchParams("health=partially_checked")
    stub([
      { ...base, id: "a", name: "Alpha", health: "partially_checked" },
      { ...base, id: "b", name: "Bravo", health: "healthy" },
      { ...base, id: "c", name: "Charlie", health: "partially_checked" },
    ])
    renderIndex()
    const strip = await screen.findByRole("group", { name: "Filter by health" })
    const chosen = within(strip).getByRole("button", { pressed: true })
    expect(chosen).toHaveTextContent("Some listings not checked yet 2")
    const table = screen.getByRole("table", {
      name: "Clients, with their Google health and open review work",
    })
    const cards = within(table).getAllByRole("row").slice(1)
    expect(cards).toHaveLength(2)
    for (const card of cards)
      expect(card).toHaveTextContent("Some listings not checked yet")
    expect(screen.getByText(/2 of 3 clients/)).toBeInTheDocument()
  })

  it("puts a broken login first even with no open reviews", async () => {
    stub([
      {
        ...base,
        id: "busy",
        name: "Busy Bar",
        health: "healthy",
        openWork: { needsReply: 12, awaitingApproval: 0, failed: 0 },
      },
      {
        ...base,
        id: "broken",
        name: "Broken Bistro",
        health: "disconnected",
        openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
      },
      {
        ...base,
        id: "setup",
        name: "Setup Cafe",
        health: "not_connected",
        openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
      },
    ])
    renderIndex()
    const table = await screen.findByRole("table", {
      name: "Clients, with their Google health and open review work",
    })
    expect(
      within(table)
        .getAllByRole("link", { name: /Bar|Bistro|Cafe/ })
        .map((link) => link.getAttribute("href"))
    ).toEqual(["/clients/broken", "/clients/setup", "/clients/busy"])
  })

  it("lays each client out as one tappable record card on a phone", async () => {
    stub([
      {
        ...base,
        health: "disconnected",
        openWork: { needsReply: 2, awaitingApproval: 1, failed: 0 },
      },
    ])
    renderIndex()
    // One table at every width; the record card comes from the column
    // priorities, so there is no second phone-only list to keep in step.
    const table = await screen.findByRole("table", {
      name: "Clients, with their Google health and open review work",
    })
    expect(
      screen.queryByRole("list", { name: "Clients" })
    ).not.toBeInTheDocument()
    const [, row] = within(table).getAllByRole("row")
    expect(row).toHaveAttribute("data-interactive")
    const cell = (priority: string) =>
      Array.from(row.querySelectorAll(`td[data-priority="${priority}"]`))
    // The name link is the keyboard route and carries only the name.
    const name = within(cell("primary")[0] as HTMLElement).getByRole("link")
    expect(name).toHaveAccessibleName("Old Crown Group")
    expect(name).toHaveAttribute("href", "/clients/c1")
    expect(cell("secondary")[0]).toHaveTextContent("Action needed")
    expect(cell("trailing")[0]).toHaveTextContent("2 to reply· 1 approval")
    // The meta line is two sentences, not a label joined to a bare value.
    expect(cell("meta").map((td) => td.getAttribute("data-label"))).toEqual([
      null,
      null,
    ])
    expect(cell("meta")[0]).toHaveTextContent("3 of 3 listings linked")
    expect(cell("meta")[1]).toHaveTextContent(/^Synced /)
    // One target: the only link in the card is the client's own name, and
    // the open work beside it is text, not a second link to the Inbox.
    expect(within(row).getAllByRole("link")).toEqual([name])
    expect(
      within(cell("trailing")[0] as HTMLElement).queryByRole("link")
    ).toBeNull()
    // A tap anywhere on the card opens the client.
    fireEvent.click(row)
    expect(push).toHaveBeenCalledWith("/clients/c1")
  })

  it("keeps the name search in the address, written once typing pauses", async () => {
    search = new URLSearchParams("q=zebra")
    stub([
      { ...base, id: "a", name: "Aardvark Cafe" },
      { ...base, id: "z", name: "Zebra Bistro" },
    ])
    renderIndex()
    const box = await screen.findByRole("searchbox", {
      name: "Filter clients by name",
    })
    expect(box).toHaveValue("zebra")
    expect(screen.queryByText("Aardvark Cafe")).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: "a" } })
    fireEvent.change(box, { target: { value: "aa" } })
    fireEvent.change(box, { target: { value: "aard" } })
    // The list follows at once; the address does not, keystroke by keystroke.
    expect(box).toHaveValue("aard")
    expect(screen.getAllByText("Aardvark Cafe").length).toBeGreaterThan(0)
    expect(replace).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/clients?q=aard", {
        scroll: false,
      })
    )
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("writes the search at once on Enter, and only once", async () => {
    stub([base])
    renderIndex()
    const box = await screen.findByRole("searchbox", {
      name: "Filter clients by name",
    })
    fireEvent.change(box, { target: { value: "old" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(replace).toHaveBeenCalledWith("/clients?q=old", { scroll: false })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("lets Back/Forward win over the field", async () => {
    search = new URLSearchParams("q=old")
    stub([base])
    const view = renderIndex()
    const box = await screen.findByRole("searchbox", {
      name: "Filter clients by name",
    })
    fireEvent.change(box, { target: { value: "olde" } })
    // The address changes underneath (Back), before the pause elapses.
    search = new URLSearchParams("q=crown")
    view.rerender(
      <QueryProvider>
        <ClientsIndex role="owner" />
      </QueryProvider>
    )
    expect(box).toHaveValue("crown")
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(replace).not.toHaveBeenCalled()
  })

  it("says where a moved page went", async () => {
    search = new URLSearchParams("moved=photos")
    stub([base])
    renderIndex()
    expect(
      await screen.findByText("Photos moved — pick a client, then its listing.")
    ).toBeInTheDocument()
    expect(movedNotice("nonsense")).toBe(
      "That page moved — pick a client, then its listing."
    )
    expect(movedNotice(null)).toBeNull()
  })

  it("lists archived clients with a way to restore them", async () => {
    search = new URLSearchParams("view=archived")
    const archived = {
      ...base,
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Closed Inn",
      archivedAt: "2026-09-01T10:00:00.000Z",
    }
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === "PATCH")
        return new Response(
          JSON.stringify({ client: { ...archived, archivedAt: null } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      const items = url.includes("archived=1") ? [archived] : [base]
      return new Response(
        JSON.stringify({ items, unassignedLocationCount: 0 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    render(
      <QueryProvider>
        <Toaster>
          <ClientsIndex role="owner" />
        </Toaster>
      </QueryProvider>
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Closed Inn" })
    )
    expect(await screen.findByText("Closed Inn restored")).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    )
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      archived: false,
    })
  })
})
