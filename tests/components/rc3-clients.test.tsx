import { render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ClientsIndex } from "@/components/clients/clients-index"
import type { ClientSummary } from "@/lib/contracts/clients"
import { QueryProvider } from "@/lib/queries/provider"

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
  openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 3, notStarted: 0 },
  lastSyncAt: "2026-09-03T10:00:00.000Z",
}

afterEach(() => vi.unstubAllGlobals())

// RC3 #10: no open work reads as a status, not a bare "Clear" control.
describe("ClientsIndex open work", () => {
  it("says a client with nothing open has nothing to reply to, as a status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ items: [base], unassignedLocationCount: 0 }),
            { headers: { "content-type": "application/json" } }
          )
      )
    )
    render(
      <QueryProvider>
        <ClientsIndex role="owner" />
      </QueryProvider>
    )
    const table = await screen.findByRole("table", {
      name: "Clients, with their Google health and open review work",
    })
    const status = within(table).getByText("Nothing to reply to")
    expect(status.closest("[data-slot=open-work-none]")).not.toBeNull()
    expect(status.closest("button, a")).toBeNull()
    expect(within(table).queryByText("Clear", { exact: true })).toBeNull()
  })
})
