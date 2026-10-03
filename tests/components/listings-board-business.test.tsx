import { render, screen } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/listings",
  useSearchParams: () => new URLSearchParams(search),
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
vi.mock("@/lib/workspace/mode", () => ({
  useWorkspaceMode: () => "business",
}))
vi.mock("@/components/listings/file-under-client", () => ({
  FileUnderClient: () => <button type="button">File under a client</button>,
}))

import { ListingsBoard } from "@/components/listings/listings-board"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import * as clientsHook from "@/lib/queries/use-clients"
import * as summaryHook from "@/lib/queries/use-listing-summary"
import * as locationsHook from "@/lib/queries/use-locations"

afterEach(() => {
  vi.restoreAllMocks()
  replace.mockClear()
  search = ""
})

const entries: locationsHook.DirectoryEntry[] = [
  {
    id: "l1",
    name: "The Barley Mow",
    linked: true,
    verified: true,
    clientId: "home",
    clientName: "Lapen Inns",
  },
  {
    id: "l2",
    name: "The Bell",
    linked: true,
    verified: true,
    clientId: "home",
    clientName: "Lapen Inns",
  },
]

function stub() {
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: entries,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [{ id: "home", name: "Lapen Inns" }],
      unassignedLocationCount: 0,
    },
    isPending: false,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(summaryHook, "useListingSummaries").mockReturnValue({
    data: entries.map((entry): ListingSummary =>
      emptyListingSummary({
        locationId: entry.id,
        linked: true,
        verified: true,
      })
    ),
    isPending: false,
  } as unknown as UseQueryResult<ListingSummary[]>)
}

describe("ListingsBoard in business mode", () => {
  it("has no client column, chips, grouping or order control", () => {
    stub()
    const { container } = render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("link", { name: "The Barley Mow" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("columnheader", { name: "Client" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("group", { name: "Filter by client" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("radiogroup", { name: "Order listings" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("File under a client")).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/client|agency/i)
  })

  it("ignores a stale ?clientId= instead of filtering by it", () => {
    search = "clientId=somebody-else&order=client"
    stub()
    render(<ListingsBoard role="owner" />)
    expect(
      screen.getByRole("link", { name: "The Barley Mow" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "The Bell" })).toBeInTheDocument()
  })

  it("asks for a search by listing only", () => {
    stub()
    render(<ListingsBoard role="owner" />)
    expect(screen.getByPlaceholderText("Search listings")).toBeInTheDocument()
  })
})
