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
  it("orders by open work, not alphabetically", async () => {
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

  it("counts each client on one tile, and a tile filters to exactly those", async () => {
    stub([
      { ...base, id: "a", name: "A", health: "disconnected" },
      { ...base, id: "b", name: "B", health: "attention" },
      { ...base, id: "c", name: "C", health: "syncing" },
    ])
    renderIndex()
    const summary = await screen.findByRole("region", {
      name: "Health summary",
    })
    const action = within(summary).getByRole("button", {
      name: /Action needed/,
    })
    expect(action).toHaveTextContent("1")
    expect(
      within(summary).getByRole("button", { name: /Data delayed/ })
    ).toHaveTextContent("1")
    // Importing clients are up to date; their pill says Importing.
    expect(
      within(summary).getByRole("button", { name: /Up to date/ })
    ).toHaveTextContent("1 importing")
    fireEvent.click(action)
    expect(replace).toHaveBeenCalledWith("/clients?health=disconnected", {
      scroll: false,
    })
  })

  it("keeps the name search in the address", async () => {
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
    fireEvent.change(box, { target: { value: "aard" } })
    expect(replace).toHaveBeenLastCalledWith("/clients?q=aard", {
      scroll: false,
    })
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
        return new Response(JSON.stringify({ client: { ...archived, archivedAt: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
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
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      archived: false,
    })
  })
})
