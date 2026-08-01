"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocations, fetchManagementLocations } from "@/lib/api/locations"
import { queryKeys } from "./keys"

export type DirectoryEntry = {
  id: string
  name: string
  address?: unknown
  verified?: boolean
  linked?: boolean
  timezone?: string
}

// `role` is passed from the server page's getSession(); it may be null under
// dev/test anonymous bootstrap, in which case we serve the plain list everyone
// can read (member/viewer never see the management columns). Always enabled.
export function useLocationDirectory(role: string | null | undefined) {
  const management = role === "owner" || role === "admin"
  return useQuery({
    queryKey: management ? queryKeys.locationsManagement : queryKeys.locations,
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (management) {
        const { locations } = await fetchManagementLocations()
        return locations.map((l) => ({
          id: l.locationId,
          name: l.name,
          address: l.address,
          verified: Boolean(l.verified),
          linked: Boolean(l.linkId),
          timezone: l.timezone,
        }))
      }
      const { locations } = await fetchLocations()
      return locations.map((l) => ({ id: l.id, name: l.name }))
    },
    staleTime: 30_000,
  })
}
