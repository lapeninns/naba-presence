import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationsIndex } from "@/components/locations/locations-index"
import * as locationsApi from "@/lib/api/locations"

function renderIndex(role: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationsIndex role={role} />
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe("LocationsIndex", () => {
  it("renders management columns for an owner", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({
      locations: [
        { locationId: "loc-1", name: "Riverside", address: { locality: "Bath" }, timezone: "Europe/London", linkId: "ll-1", externalLocationId: "e-1", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true, clientId: null, clientName: null },
      ],
    })
    renderIndex("owner")
    expect(await screen.findByRole("columnheader", { name: "Location" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Address" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Google" })).toBeInTheDocument()
    const link = await screen.findByRole("link", { name: "Riverside" })
    expect(link).toHaveAttribute("href", "/locations/loc-1")
    expect(screen.getByText("Bath")).toBeInTheDocument()
    expect(screen.getByText("Verified")).toBeInTheDocument()
    // A location no one has filed yet is grouped and explained, not hidden.
    expect(screen.getByText("Unassigned locations")).toBeInTheDocument()
  })

  it("renders a plain single-column list for a member and no management columns", async () => {
    vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({
      locations: [{ id: "loc-9", name: "Old Town", linked: true, clientId: null, clientName: null }],
    })
    renderIndex("member")
    expect(await screen.findByRole("link", { name: "Old Town" })).toHaveAttribute("href", "/locations/loc-9")
    expect(screen.queryByRole("columnheader", { name: "Google" })).not.toBeInTheDocument()
  })

  it("points an owner at the connect flow when there are no locations", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({ locations: [] })
    renderIndex("owner")
    expect(await screen.findByText("No business connected yet")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute(
      "href",
      "/settings/connections"
    )
  })

  it("offers a member no connect link, since /settings/connections would bounce them", async () => {
    vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({ locations: [] })
    renderIndex("member")
    expect(await screen.findByText("No business connected yet")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Connect Google" })).not.toBeInTheDocument()
  })
})
