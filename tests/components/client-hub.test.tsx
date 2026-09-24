import { render, screen, within } from "@testing-library/react"
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
    vi.fn<typeof fetch>(
      async () =>
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
    expect(screen.getByText("Up to date")).toBeInTheDocument()
    expect(screen.getByText("Needs reply")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    // Each work tile opens the inbox already filtered to this client.
    expect(screen.getByRole("link", { name: /Needs reply/ })).toHaveAttribute(
      "href",
      "/inbox?clientId=c1&queue=needs_reply"
    )
  })

  it("links each location straight into its sections", async () => {
    // The whole point of the hub: an operator should not have to open the
    // location and then hunt for the tab.
    stub()
    renderHub()
    const sections = await screen.findByRole("navigation", {
      name: "Old Crown Girton sections",
    })
    expect(sections.querySelector('a[href="/listings/l1/photos"]')).toBeTruthy()
    // The overview is the listing's name, already a link; a "Listing" section
    // link beside it was a second stop to the same page.
    expect(sections.querySelector('a[href="/listings/l1"]')).toBeNull()
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toHaveAttribute("href", "/listings/l1")
    // On a narrow row the same sections sit behind one menu.
    expect(
      screen.getByRole("button", { name: "More for Old Crown Girton" })
    ).toBeInTheDocument()
  })

  it("offers a way to add locations when the client has none", async () => {
    stub({
      client: { ...client, locationCount: 0, linkedCount: 0 },
      locations: [],
    })
    renderHub()
    expect(await screen.findByText("No listings yet")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Add listings from Google" })
    ).toHaveAttribute("href", "/setup?client=c1&step=locations")
  })

  it("offers a member no management actions they cannot perform", async () => {
    stub({
      client: { ...client, locationCount: 0, linkedCount: 0 },
      locations: [],
    })
    renderHub(false)
    await screen.findByText("No listings yet")
    expect(
      screen.queryByRole("link", { name: "Add listings from Google" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Settings" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /Finish setup/ })
    ).not.toBeInTheDocument()
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
      await screen.findByText(/Google stopped accepting ops@lapeninns\.co\.uk/)
    ).toBeInTheDocument()
    // The fix sits inside the one alert that explains it.
    const alert = screen
      .getByText("Google login needs reconnecting")
      .closest('[data-slot="alert"]') as HTMLElement
    expect(
      within(alert).getByRole("link", { name: "Reconnect Google" })
    ).toHaveAttribute("href", "/setup?client=c1&step=connect")
    expect(screen.getByText(/Needs reconnecting/)).toBeInTheDocument()
    expect(screen.getByText("Linked · paused")).toBeInTheDocument()
  })

  it("tells a lost listing apart from a broken login", async () => {
    // The login works; one listing no longer lists it as a manager. The chip,
    // the alert and the row must all say that, and none may offer a
    // reconnect, which would not help.
    stub({
      client: {
        ...client,
        health: "disconnected",
        connections: [
          {
            id: "gc1",
            googleEmail: "ops@lapeninns.co.uk",
            status: "active",
            reconnectRequired: false,
            lastRefreshAt: "2026-09-03T10:00:00.000Z",
          },
        ],
        freshness: {
          state: "action_needed",
          reason: "listing_access_lost",
          lastSuccessfulCheckAt: null,
        },
        checks: {
          stalestCheckAt: null,
          lastSuccessfulCheckAt: null,
          accessLost: 1,
        },
      },
      locations: [{ ...location, accessLost: true }],
    })
    renderHub()
    expect(
      await screen.findByText("A listing can’t be reached")
    ).toBeInTheDocument()
    expect(screen.getByText(/Reconnecting won’t fix this/)).toBeInTheDocument()
    expect(
      screen.getByText("Connected · a listing is unreachable")
    ).toBeInTheDocument()
    expect(screen.getByText("Linked · no manager access")).toBeInTheDocument()
    expect(screen.queryByText("Google login needs reconnecting")).toBeNull()
    expect(screen.queryByRole("link", { name: /Reconnect/ })).toBeNull()
  })

  it("does not call an expiring access token a broken login", async () => {
    stub({
      client: {
        ...client,
        connections: [
          {
            id: "gc1",
            googleEmail: "ops@lapeninns.co.uk",
            status: "expired",
            reconnectRequired: false,
            lastRefreshAt: null,
          },
        ],
      },
    })
    renderHub()
    expect(await screen.findByText("Connected")).toBeInTheDocument()
    expect(screen.queryByText(/Needs reconnecting/)).toBeNull()
    expect(screen.queryByText("Google login needs reconnecting")).toBeNull()
  })
})
