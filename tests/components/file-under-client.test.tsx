import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { FileUnderClient } from "@/components/listings/file-under-client"
import { Toaster } from "@/components/ui/toast"

const clients: QueryClient[] = []
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <FileUnderClient locationId="l1" locationName="Old Crown" />
      </Toaster>
    </QueryClientProvider>
  )
}
function emptyClients() {
  return new Response(
    JSON.stringify({ items: [], unassignedLocationCount: 1 }),
    { status: 200 }
  )
}
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
})

describe("FileUnderClient recovery", () => {
  it("announces loading while the client request is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise(() => {}))
    )
    mount()
    expect(screen.getByRole("status")).toHaveTextContent(/loading clients/i)
    expect(
      screen.queryByRole("link", { name: "Create client" })
    ).not.toBeInTheDocument()
  })
  it("offers explicit creation with listing return context when there are no clients", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(emptyClients())
    vi.stubGlobal("fetch", fetcher)
    mount()
    expect(
      await screen.findByRole("link", { name: "Create client" })
    ).toHaveAttribute("href", "/clients/new?listing=l1")
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET")
  })
  it("shows request failure and retries into the empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValue(emptyClients())
    )
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry clients" })
    )
    expect(
      await screen.findByRole("link", { name: "Create client" })
    ).toHaveAttribute("href", "/clients/new?listing=l1")
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Create client" })).toHaveFocus()
    )
  })
})

it("files only the chosen listing through the additive assignment endpoint", async () => {
  const assignedClient = {
    id: "c1",
    name: "Existing group",
    slug: "existing",
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01",
    locationCount: 2,
    linkedCount: 2,
    verifiedCount: 2,
    health: "healthy",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 0, notStarted: 0 },
    lastSyncAt: null,
  }
  const fetcher = vi.fn<typeof fetch>(
    async (input, init) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { assigned: ["l1"] }
            : { items: [assignedClient], unassignedLocationCount: 1 }
        ),
        { status: 200 }
      )
  )
  vi.stubGlobal("fetch", fetcher)
  mount()
  fireEvent.click(
    await screen.findByRole("combobox", {
      name: "File Old Crown under a client",
    })
  )
  fireEvent.click(await screen.findByRole("option", { name: "Existing group" }))
  await screen.findByText("Old Crown filed under Existing group")
  const mutation = fetcher.mock.calls.find((call) => call[1]?.method === "POST")
  expect(mutation?.[0]).toBe("/api/clients/c1/locations")
  expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
    locationIds: ["l1"],
    grantToClientMembers: true,
  })
})
