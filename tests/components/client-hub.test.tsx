import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ClientHub } from "@/components/clients/client-hub"
import { QueryProvider } from "@/lib/queries/provider"
import type { ClientResponse } from "@/lib/contracts/clients"

const client: ClientResponse["client"] = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 2,
  linkedCount: 2,
  verifiedCount: 1,
  health: "healthy",
  connections: [],
  openWork: { needsReply: 5, awaitingApproval: 1, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 2, notStarted: 0 },
  lastSyncAt: "2026-09-03T10:00:00.000Z",
}

const location = {
  locationId: "l1",
  name: "Old Crown Girton",
  address: null,
  timezone: "Europe/London",
  linkId: "ll1",
  externalLocationId: "e1",
  googleLocationName: "locations/1",
  googleTitle: "Old Crown Girton",
  verified: true,
  clientId: "c1",
  clientName: "Old Crown Group",
}

function stub(response: Partial<ClientResponse> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ client, locations: [location], ...response }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
  )
}

afterEach(() => vi.unstubAllGlobals())

const renderHub = (canManage = true) =>
  render(
    <QueryProvider>
      <ClientHub clientId="c1" canManage={canManage} />
    </QueryProvider>
  )

describe("ClientHub", () => {
  it("leads with the client's name, health and what needs doing", async () => {
    stub()
    renderHub()
    expect(
      await screen.findByRole("heading", { name: "Old Crown Group", level: 1 })
    ).toBeInTheDocument()
    expect(screen.getByText("Healthy")).toBeInTheDocument()
    expect(screen.getByText("Needs reply")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
  })

  it("links each location straight into its sections", async () => {
    // The whole point of the hub: an operator should not have to open the
    // location and then hunt for the tab.
    stub()
    renderHub()
    const sections = await screen.findByRole("navigation", {
      name: "Old Crown Girton sections",
    })
    expect(sections.querySelector('a[href="/listings/l1"]')).toBeTruthy()
    expect(sections.querySelector('a[href="/listings/l1/photos"]')).toBeTruthy()
  })

  it("offers a way to add locations when the client has none", async () => {
    stub({ client: { ...client, locationCount: 0, linkedCount: 0 }, locations: [] })
    renderHub()
    expect(await screen.findByText("No locations yet")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Add locations from Google" })
    ).toHaveAttribute("href", "/setup?client=c1&step=locations")
  })

  it("offers a member no management actions they cannot perform", async () => {
    stub({ client: { ...client, locationCount: 0, linkedCount: 0 }, locations: [] })
    renderHub(false)
    await screen.findByText("No locations yet")
    expect(
      screen.queryByRole("link", { name: "Add locations from Google" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Client settings" })).not.toBeInTheDocument()
  })

  it("names the broken login when Google needs reconnecting", async () => {
    stub({
      client: {
        ...client,
        health: "disconnected",
        connections: [
          {
            id: "gc1",
            googleEmail: "ops@lapeninns.co.uk",
            status: "expired",
            reconnectRequired: true,
            lastRefreshAt: null,
          },
        ],
      },
    })
    renderHub()
    expect(
      await screen.findByText(/ops@lapeninns\.co\.uk can no longer reach/)
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/setup?client=c1&step=connect"
    )
  })
})
