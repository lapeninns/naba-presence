import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ImportCard } from "@/components/settings/import-card"
import { Toaster } from "@/components/ui/toast"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
const locationsMock = vi.fn()
const importMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))
vi.mock("@/lib/queries/use-google-locations", () => ({ useGoogleLocations: (accountName: string | null) => locationsMock(accountName) }))
vi.mock("@/lib/queries/use-location-import", () => ({ useLocationImport: () => importMock() }))
vi.mock("@/lib/api/locations", () => ({
  fetchManagementLocations: vi.fn(async () => ({ locations: [] })),
  fetchLocations: vi.fn(async () => ({ locations: [] })),
}))
// ImportCard only ever renders behind /settings/connections, which the server
// gates to owner/admin — so the directory it reads is always the management
// view. The real useLocationDirectory runs underneath.
vi.mock("@/lib/queries/use-session", () => ({ useSessionRole: () => "owner" }))

function discovered(overrides: Partial<DiscoveredLocation>): DiscoveredLocation {
  return {
    id: "e1",
    accountName: "accounts/1",
    googleLocationName: "locations/1",
    title: "Riverside Rooms",
    address: "1 River Road, Bath",
    verified: true,
    ...overrides,
  }
}

function renderCard(locations: DiscoveredLocation[], link = { mutateAsync: vi.fn(async () => ({ link: {} })), isPending: false }) {
  workspaceMock.mockReturnValue({ query: { data: { connections: [{ id: "c1", status: "active" }] } } })
  accountsMock.mockReturnValue({ query: { data: { accounts: [{ id: "a1", googleAccountName: "accounts/1", isActive: true }] } } })
  locationsMock.mockReturnValue({ data: { locations }, isPending: false, isError: false, refetch: vi.fn() })
  importMock.mockReturnValue({ link, unlink: { mutate: vi.fn(), isPending: false } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ImportCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ImportCard", () => {
  it("lists discovered locations and imports one on click", async () => {
    const mutateAsync = vi.fn(async () => ({ link: {} }))
    renderCard([discovered({})], { mutateAsync, isPending: false })
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Import Riverside Rooms" }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ externalLocationId: "e1", confirmRelink: false }))
  })

  it("lets a login with several accounts import from each of them", async () => {
    renderCard([discovered({})])
    accountsMock.mockReturnValue({
      query: {
        data: {
          accounts: [
            { id: "a1", googleAccountName: "accounts/1", accountName: "Lapen North", isActive: true, googleConnectionId: "c1" },
            { id: "a2", googleAccountName: "accounts/2", accountName: "Lapen South", isActive: true, googleConnectionId: "c1" },
            { id: "a3", googleAccountName: "accounts/3", accountName: "Other login", isActive: true, googleConnectionId: "c2" },
          ],
        },
      },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <ImportCard clientId="client-1" connectionId="c1" />
        </Toaster>
      </QueryClientProvider>
    )
    // Only this login's accounts, and the first is shown rather than a dead
    // end asking to choose.
    const switcher = screen.getAllByRole("tablist", { name: "Business Profile account" }).at(-1)!
    expect(switcher).toHaveTextContent("Lapen North")
    expect(switcher).toHaveTextContent("Lapen South")
    expect(switcher).not.toHaveTextContent("Other login")
    expect(locationsMock).toHaveBeenLastCalledWith("accounts/1")
    fireEvent.click(screen.getAllByRole("tab", { name: "Lapen South" }).at(-1)!)
    await waitFor(() => expect(locationsMock).toHaveBeenLastCalledWith("accounts/2"))
  })

  it("shows an empty state when discovery returns nothing", () => {
    renderCard([])
    expect(screen.getByText("No locations to import")).toBeInTheDocument()
  })
})
