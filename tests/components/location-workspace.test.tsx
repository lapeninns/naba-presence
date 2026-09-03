import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationWorkspace } from "@/components/locations/location-workspace"
import * as locationsApi from "@/lib/api/locations"

const notFound = vi.fn()
vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1", notFound: () => notFound() }))

function renderWorkspace(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationWorkspace locationId="loc-1" role={role}>
        <p>tab body</p>
      </LocationWorkspace>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  notFound.mockReset()
})

describe("LocationWorkspace", () => {
  it("renders the location name as the h1 and the tab body", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({
      locations: [{ locationId: "loc-1", name: "Riverside", address: null, timezone: "Europe/London", linkId: "ll", externalLocationId: "e", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true, clientId: null, clientName: null }],
    })
    renderWorkspace("owner")
    expect(await screen.findByRole("heading", { level: 1, name: "Riverside" })).toBeInTheDocument()
    expect(screen.getByText("tab body")).toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("calls notFound() when the id is absent from the directory", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({ locations: [] })
    renderWorkspace("owner")
    await screen.findByText("tab body") // wait for the query to settle
    expect(notFound).toHaveBeenCalled()
  })
})
