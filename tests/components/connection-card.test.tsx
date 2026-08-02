import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionCard } from "@/components/settings/connection-card"
import { Toaster } from "@/components/ui/toast"
import type { ConnectionSummary } from "@/lib/api/connections"

const workspaceMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))

function connection(overrides: Partial<ConnectionSummary>): ConnectionSummary {
  return {
    id: "c1",
    googleEmail: "owner@riverside.test",
    status: "active",
    notificationsEnabled: true,
    lastRefreshAt: "2026-08-01T00:00:00.000Z",
    lastErrorCode: null,
    reconnectRequired: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCard(connections: ConnectionSummary[]) {
  workspaceMock.mockReturnValue({
    query: { data: { connections }, isPending: false, isError: false, refetch: vi.fn() },
    connect: { mutate: vi.fn(), isPending: false },
    disconnect: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ConnectionCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ConnectionCard", () => {
  it("lists a connected account with a humanised status and a disconnect action", () => {
    renderCard([connection({})])
    expect(screen.getByText("owner@riverside.test")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disconnect owner@riverside.test" })).toBeInTheDocument()
  })

  it("offers a connect button when there are no connections", () => {
    renderCard([])
    expect(screen.getByRole("button", { name: "Connect Google Business Profile" })).toBeInTheDocument()
  })
})
