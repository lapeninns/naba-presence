import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationsIndex } from "@/components/locations/locations-index"
import { queryKeys } from "@/lib/queries/keys"
import * as locationsApi from "@/lib/api/locations"

// Regression guards for two cache bugs that primary-location resolution would
// otherwise read straight into: a shape collision on the directory key, and a
// key namespace that let one import drop every per-location cache.

describe("location directory cache", () => {
  it.each([
    ["management", "owner" as const, queryKeys.locationsManagement],
    ["default", "member" as const, queryKeys.locations],
  ])(
    "stores a mapped array under the %s key, not the raw response envelope",
    async (_label, role, key) => {
      vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({
        locations: [
          {
            locationId: "loc-1",
            name: "Riverside",
            address: null,
            timezone: "Europe/London",
            linkId: "link-1",
            externalLocationId: "ext-1",
            googleLocationName: "locations/1",
            googleTitle: "Riverside",
            verified: true, clientId: null, clientName: null,
          },
        ],
      })
      vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({
        locations: [{ id: "loc-1", name: "Riverside", linked: true, clientId: null, clientName: null }],
      })

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <LocationsIndex role={role} />
        </QueryClientProvider>
      )
      await screen.findByRole("link", { name: "Riverside" })

      // The bug this pins: a second caller writing `{locations: [...]}` here
      // made `.length`/`.find` undefined for everyone else sharing the client.
      const cached = client.getQueryData(key)
      expect(Array.isArray(cached)).toBe(true)
      expect(cached).toHaveLength(1)
    }
  )

  it("keeps directory keys out of the per-location resource namespace", () => {
    // React Query matches invalidations by prefix. While the directory lived
    // at ["locations"], invalidating it on every link/unlink also dropped
    // ["locations", <id>, "profile"|"hours"|…] for every location in the org.
    const perLocation = queryKeys.locationProfile("loc-1") as readonly unknown[]
    const directory = queryKeys.locations as readonly unknown[]
    expect(perLocation[0]).not.toBe(directory[0])

    // …and the management view must stay a prefix-child of the directory root,
    // so one invalidation still covers both views.
    expect((queryKeys.locationsManagement as readonly unknown[])[0]).toBe(
      directory[0]
    )
  })
})
