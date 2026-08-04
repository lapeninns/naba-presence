"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocations, fetchManagementLocations } from "@/lib/api/locations"
import {
  toDirectoryEntriesFromDefault,
  toDirectoryEntriesFromManagement,
  type DirectoryEntry,
} from "@/lib/locations/directory"
import { queryKeys } from "./keys"

// Re-exported so existing importers keep working; the type and its mappers
// live in lib/locations/directory.ts because the server layout needs them too
// and cannot import from a "use client" module at runtime.
export type { DirectoryEntry }

// `role` is passed from the server page's getSession(); it may be null under
// dev/test anonymous bootstrap, in which case we serve the plain list everyone
// can read (member/viewer never see the management columns). Always enabled.
//
// This hook is the ONLY writer of both directory keys. Anything needing the
// location list must go through it rather than calling fetchLocations /
// fetchManagementLocations into the same key directly — two callers writing
// the raw `{locations: […]}` envelope where this writes a mapped array is a
// shape collision that survives client navigation inside one QueryClient.
export function useLocationDirectory(role: string | null | undefined) {
  const management = role === "owner" || role === "admin"
  return useQuery({
    queryKey: management ? queryKeys.locationsManagement : queryKeys.locations,
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (management) {
        const { locations } = await fetchManagementLocations()
        return toDirectoryEntriesFromManagement(locations)
      }
      const { locations } = await fetchLocations()
      return toDirectoryEntriesFromDefault(locations)
    },
    staleTime: 30_000,
  })
}
