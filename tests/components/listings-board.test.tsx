import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""),
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

afterEach(() => vi.restoreAllMocks())

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

describe("ListingsBoard", () => {
  it("puts unfiled listings first and offers to file them", () => {
    stub({
      entries,
      summaries: entries.map((entry) => summary({ locationId: entry.id })),
    })
    render(<ListingsBoard role="owner" />)
    const rows = screen.getAllByRole("row").slice(1)
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
    await userEvent.click(screen.getByRole("tab", { name: "To publish" }))
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Harbour View" })
    ).not.toBeInTheDocument()
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
    expect(
      screen.getByRole("link", { name: /Add listings from Google/ })
    ).toHaveAttribute("href", "/setup")
  })
})
