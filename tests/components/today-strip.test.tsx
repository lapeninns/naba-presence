import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

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

import {
  AttentionChip,
  attentionRows,
} from "@/components/inbox/today/attention-chip"
import {
  ClientChips,
  clientChipRows,
} from "@/components/inbox/today/client-chips"
import { TodayStrip } from "@/components/inbox/today/today-strip"
import type { AnalyticsLocation, AnalyticsOverview } from "@/lib/api/analytics"
import type { ClientSummary } from "@/lib/contracts/clients"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"
import * as clientsHook from "@/lib/queries/use-clients"
import * as sessionHook from "@/lib/queries/use-session"

function client(
  overrides: Partial<ClientSummary> & { id: string; name: string }
) {
  return {
    colour: null,
    slug: overrides.id,
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
    ...overrides,
  } as ClientSummary
}

function location(
  input: Pick<AnalyticsLocation, "id" | "name" | "unresolvedComplaints">
): AnalyticsLocation {
  return {
    reviews: 0,
    averageRating: null,
    responseRate: null,
    medianFirstResponseSeconds: null,
    p95FirstResponseSeconds: null,
    medianLatestEditSeconds: null,
    verificationRejectionRate: null,
    ...input,
  }
}

function stubShell({
  clients = [],
  locations = [],
  nextStep = "done",
  role = "owner",
  clientsPending = false,
}: {
  clients?: ClientSummary[]
  locations?: AnalyticsLocation[]
  nextStep?: string
  role?: string
  clientsPending?: boolean
} = {}) {
  vi.spyOn(sessionHook, "useSessionRole").mockReturnValue(role as "owner")
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: clientsPending
      ? undefined
      : { items: clients, unassignedLocationCount: 0 },
    isPending: clientsPending,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(clientsHook, "useClientSetup").mockReturnValue({
    data: { setup: { nextStep } },
  } as unknown as ReturnType<typeof clientsHook.useClientSetup>)
  vi.spyOn(analyticsHook, "useAnalyticsOverview").mockReturnValue({
    data: { locations } as AnalyticsOverview,
    isPending: false,
  } as unknown as UseQueryResult<AnalyticsOverview>)
}

afterEach(() => vi.restoreAllMocks())

describe("clientChipRows", () => {
  it("sums open work and puts the busiest client first", () => {
    const rows = clientChipRows([
      client({
        id: "a",
        name: "Airport",
        openWork: { needsReply: 1, awaitingApproval: 0, failed: 0 },
      }),
      client({
        id: "b",
        name: "Bridge",
        openWork: { needsReply: 2, awaitingApproval: 3, failed: 1 },
      }),
      client({
        id: "c",
        name: "Canal",
        openWork: { needsReply: 1, awaitingApproval: 0, failed: 0 },
      }),
    ])
    expect(rows.map((row) => [row.name, row.open])).toEqual([
      ["Bridge", 6],
      ["Airport", 1],
      ["Canal", 1],
    ])
  })
})

describe("ClientChips", () => {
  it("scopes to a client on press and clears on a second press", async () => {
    const onSelect = vi.fn()
    const rows = clientChipRows([
      client({ id: "a", name: "Airport" }),
      client({ id: "b", name: "Bridge", health: "disconnected" }),
    ])
    const { rerender } = render(<ClientChips rows={rows} onSelect={onSelect} />)
    const bridge = screen.getByRole("button", { name: /Bridge/ })
    expect(bridge).toHaveAttribute("aria-pressed", "false")
    expect(bridge).toHaveAccessibleName(/Disconnected/)
    await userEvent.click(bridge)
    expect(onSelect).toHaveBeenCalledWith("b")

    rerender(<ClientChips rows={rows} selectedId="b" onSelect={onSelect} />)
    expect(screen.getByRole("button", { name: /Bridge/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await userEvent.click(screen.getByRole("button", { name: /Bridge/ }))
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })
})

describe("AttentionChip", () => {
  it("lists the worst five, most complaints first, each linking into the inbox", async () => {
    const rows = attentionRows([
      location({ id: "a", name: "Airport", unresolvedComplaints: 1 }),
      location({ id: "b", name: "Bridge", unresolvedComplaints: 9 }),
      location({ id: "c", name: "Canal", unresolvedComplaints: 0 }),
      location({ id: "d", name: "Dock", unresolvedComplaints: 4 }),
      location({ id: "e", name: "Ember", unresolvedComplaints: 3 }),
      location({ id: "f", name: "Fern", unresolvedComplaints: 2 }),
      location({ id: "g", name: "Gate", unresolvedComplaints: 5 }),
    ])
    expect(rows.map((row) => row.name)).toEqual([
      "Bridge",
      "Gate",
      "Dock",
      "Ember",
      "Fern",
    ])
    render(<AttentionChip rows={rows} total={6} />)
    await userEvent.click(
      screen.getByRole("button", { name: "6 locations need attention" })
    )
    const bridge = await screen.findByRole("link", { name: /Bridge/ })
    expect(bridge).toHaveAttribute("href", "/inbox?locationId=b&rating=1,2")
    expect(
      screen.getByText(/1–2 star reviews with no published reply/i)
    ).toBeInTheDocument()
  })

  it("renders nothing when nothing needs attention", () => {
    const { container } = render(<AttentionChip rows={[]} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("TodayStrip", () => {
  it("renders nothing for a caught-up single-client agency", () => {
    stubShell({ clients: [client({ id: "a", name: "Airport" })] })
    const { container } = render(<TodayStrip onClientChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("names the first client's next setup step", () => {
    stubShell({
      clients: [client({ id: "a", name: "Airport" })],
      nextStep: "locations",
    })
    render(<TodayStrip onClientChange={vi.fn()} />)
    expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Finish setup for Airport/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Finish setup for Airport/ })
    ).toHaveAttribute("href", "/setup?client=a&step=locations")
  })

  it("hides the setup nudge from members", () => {
    stubShell({
      clients: [client({ id: "a", name: "Airport" })],
      nextStep: "locations",
      role: "member",
    })
    const { container } = render(<TodayStrip onClientChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows client chips only once there are two clients", () => {
    stubShell({
      clients: [
        client({ id: "a", name: "Airport" }),
        client({ id: "b", name: "Bridge" }),
      ],
    })
    render(<TodayStrip clientId="b" onClientChange={vi.fn()} />)
    const group = screen.getByRole("group", { name: "Work by client" })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Bridge/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("is busy while the client list loads", () => {
    stubShell({ clientsPending: true })
    const { container } = render(<TodayStrip onClientChange={vi.fn()} />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("adds the attention chip when a location has unresolved low ratings", () => {
    stubShell({
      clients: [client({ id: "a", name: "Airport" })],
      locations: [location({ id: "l", name: "Lock", unresolvedComplaints: 2 })],
    })
    render(<TodayStrip onClientChange={vi.fn()} />)
    expect(
      screen.getByRole("button", { name: "1 location needs attention" })
    ).toBeInTheDocument()
  })
})
