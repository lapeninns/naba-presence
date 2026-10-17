import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
    expect(screen.getByText("In sync")).toBeInTheDocument()
    expect(screen.getByText("Needs reply")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    // Each work tile opens the inbox already filtered to this client.
    // The name starts with the visible label. (jsdom joins the tile's
    // block-styled spans without a space; a browser puts one between them.)
    const tile = screen.getByRole("link", { name: /^Needs reply\s*5/ })
    expect(tile).toHaveAttribute("href", "/inbox?clientId=c1&queue=needs_reply")
    // The shared KpiTile is itself the link: one tab stop per tile.
    expect(tile).toHaveAttribute("data-slot", "kpi-tile")
    expect(tile.querySelectorAll("a, button")).toHaveLength(0)
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
    const name = screen.getByRole("link", { name: "Old Crown Girton" })
    expect(name).toHaveAttribute("href", "/listings/l1")
    // The record card's way in is a 44px row on touch, a text link at the
    // desk (the name alone was two 18px lines on a phone).
    expect(name).toHaveClass("min-h-(--np-touch)", "desk:min-h-0")
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
      screen.queryByRole("link", { name: /Finish setup/ })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "More actions" }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Report" })).toBeTruthy()
    expect(
      within(menu).queryByRole("menuitem", { name: "Settings" })
    ).toBeNull()
    expect(
      within(menu).queryByRole("menuitem", { name: "Share report" })
    ).toBeNull()
  })

  it("lets an owner or admin share the client's report", async () => {
    stub()
    renderHub()
    await screen.findByRole("heading", { name: "Old Crown Group", level: 1 })
    await userEvent.click(screen.getByRole("button", { name: "More actions" }))
    const menu = await screen.findByRole("menu")
    expect(
      within(menu).getByRole("menuitem", { name: "Share report" })
    ).toBeInTheDocument()
  })

  it("has one primary action, with the rest behind More", async () => {
    stub()
    renderHub()
    await screen.findByRole("heading", { name: "Old Crown Group", level: 1 })
    // Open inbox is the only action in the header; Report, Share report and
    // Settings are not four more buttons.
    expect(screen.getByRole("link", { name: "Open inbox" })).toHaveAttribute(
      "href",
      "/inbox?clientId=c1"
    )
    expect(screen.queryByRole("link", { name: "Report" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Share report" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "More actions" }))
    const menu = await screen.findByRole("menu")
    expect(
      within(menu).getByRole("menuitem", { name: "Report" })
    ).toHaveAttribute("href", "/reports?clientId=c1")
    expect(
      within(menu).getByRole("menuitem", { name: "Settings" })
    ).toHaveAttribute("href", "/clients/c1/settings")
    expect(
      within(menu).getByRole("menuitem", { name: "Share report" })
    ).toBeInTheDocument()
  })

  it("makes Finish setup the one primary while a client is not set up", async () => {
    stub({
      client: { ...client, health: "not_connected", linkedCount: 0 },
      locations: [],
    })
    renderHub()
    expect(
      await screen.findByRole("link", { name: "Finish setup" })
    ).toHaveAttribute("href", "/setup?client=c1")
    expect(screen.queryByRole("link", { name: "Open inbox" })).toBeNull()
  })

  it("names the cause beside Needs attention, never 'up to date'", async () => {
    stub({
      client: {
        ...client,
        health: "attention",
        freshness: {
          state: "up_to_date",
          reason: null,
          lastSuccessfulCheckAt: "2026-09-03T10:00:00.000Z",
        },
      },
    })
    renderHub()
    expect(await screen.findByText("Needs attention")).toBeInTheDocument()
    expect(
      screen.getByText(/A linked listing has changed on Google/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Review checks are up to date/)).toBeNull()
  })

  it("shows a pill only for listings in a non-default state", async () => {
    stub({
      locations: [
        location,
        {
          ...location,
          locationId: "l2",
          name: "Old Crown Histon",
          linkId: "ll2",
          verified: false,
        },
        {
          ...location,
          locationId: "l3",
          name: "Old Crown Ely",
          linkId: null,
          verified: false,
        },
      ],
    })
    renderHub()
    await screen.findByRole("link", { name: "Old Crown Girton" })
    // Not linked and not verified are states worth a pill.
    expect(screen.getByText("Not verified")).toBeInTheDocument()
    expect(screen.getByText("Not linked")).toBeInTheDocument()
    // Linked and verified are the default: plain text, not a pill.
    for (const label of ["Linked", "Verified"]) {
      for (const el of screen.getAllByText(label)) {
        expect(el.closest('[data-slot="status-pill"]')).toBeNull()
      }
    }
  })

  // DSK-10: the listings board's Health and Waiting, read from the client
  // payload. A state the Google and Verified cells already say is not said
  // again as a pill.
  it("shows each listing's Health and what is waiting, from the payload", async () => {
    stub({
      locations: [
        { ...location, health: "healthy", waiting: 0 },
        {
          ...location,
          locationId: "l2",
          name: "Old Crown Histon",
          linkId: "ll2",
          health: "unpublished",
          waiting: 3,
        },
        {
          ...location,
          locationId: "l3",
          name: "Old Crown Ely",
          linkId: "ll3",
          verified: false,
          health: "pending_verification",
          waiting: 0,
        },
      ],
    })
    renderHub()
    await screen.findByRole("link", { name: "Old Crown Girton" })
    expect(
      screen.getByRole("columnheader", { name: "Health" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("columnheader", { name: "Waiting" })
    ).toBeInTheDocument()
    const rowOf = (name: string) =>
      screen.getByRole("link", { name }).closest("tr")!
    expect(within(rowOf("Old Crown Girton")).getByText("In sync")).toBeTruthy()
    const histon = within(rowOf("Old Crown Histon"))
    expect(histon.getByText("Changes to publish")).toBeTruthy()
    expect(histon.getByText("3 waiting")).toBeTruthy()
    // "Not verified" is already the Verified cell's pill.
    expect(screen.queryByText("Pending verification")).toBeNull()
  })

  // An expired token is not "Linked · paused" in the Google cell, so a
  // disconnected listing keeps its word in Health rather than a bare dash.
  it("keeps a listing's Disconnected in Health when the Google cell does not say it", async () => {
    stub({
      locations: [{ ...location, health: "disconnected", waiting: 0 }],
    })
    renderHub()
    const row = (
      await screen.findByRole("link", { name: "Old Crown Girton" })
    ).closest("tr")!
    expect(within(row).getByText("Disconnected")).toBeTruthy()
  })

  it("leaves the Health and Waiting cells empty for an older response without them", async () => {
    stub()
    renderHub()
    await screen.findByRole("link", { name: "Old Crown Girton" })
    const row = screen
      .getByRole("link", { name: "Old Crown Girton" })
      .closest("tr")!
    expect(within(row).queryByText("In sync")).toBeNull()
    expect(within(row).queryByText(/^\d+ waiting$/)).toBeNull()
  })

  it("does not repeat the linked and verified counts above the table", async () => {
    stub()
    renderHub()
    await screen.findByRole("link", { name: "Old Crown Girton" })
    expect(screen.queryByText(/\d+ linked · \d+ verified/)).toBeNull()
    expect(
      screen.getByRole("link", { name: /^Listings linked\s*2 \/ 2/ })
    ).toBeInTheDocument()
  })

  it("uses plain labels for the login, past reviews and failed replies", async () => {
    stub({
      client: {
        ...client,
        backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 1 },
        connections: [
          {
            id: "gc1",
            googleEmail: "ops@lapeninns.co.uk",
            status: "active",
            reconnectRequired: false,
            lastRefreshAt: null,
          },
        ],
      },
    })
    renderHub()
    expect(await screen.findByText(/Google login:/)).toBeInTheDocument()
    expect(screen.queryByText(/Behind it/)).toBeNull()
    expect(
      screen.getByRole("heading", { name: "Past reviews" })
    ).toBeInTheDocument()
    expect(screen.queryByText("Review import")).toBeNull()
    expect(
      screen.getByText(/Bring in the reviews Google already holds/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Bring in past reviews" })
    ).toHaveAttribute("href", "/setup?client=c1&step=backfill")
    expect(screen.getByText("Replies that didn’t post")).toBeInTheDocument()
    expect(screen.queryByText("Failed publishes")).toBeNull()
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
