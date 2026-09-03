import { render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/clients",
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ClientsIndex } from "@/components/clients/clients-index"
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
    vi.fn(async () =>
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
      { ...base, id: "a", name: "Aardvark Cafe", openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 } },
      { ...base, id: "z", name: "Zebra Bistro", openWork: { needsReply: 9, awaitingApproval: 1, failed: 0 } },
    ])
    renderIndex()
    const links = await screen.findAllByRole("link", { name: /Cafe|Bistro/ })
    expect(links[0]).toHaveTextContent("Zebra Bistro")
  })

  it("shows health as a word beside every client", async () => {
    stub([{ ...base, health: "disconnected" }])
    renderIndex()
    expect(await screen.findByText("Disconnected")).toBeInTheDocument()
  })

  it("surfaces unassigned locations rather than hiding them", async () => {
    stub([base], 2)
    renderIndex()
    expect(await screen.findByText("2 locations have no client")).toBeInTheDocument()
  })

  it("invites an owner to create the first client", async () => {
    stub([])
    renderIndex("owner")
    expect(await screen.findByText("Set up your first client")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New client" })).toHaveAttribute(
      "href",
      "/clients/new"
    )
  })

  it("tells a member who to ask instead of offering a button they cannot use", async () => {
    stub([])
    renderIndex("member")
    expect(await screen.findByText("No clients yet")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "New client" })).not.toBeInTheDocument()
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
})
