import "server-only"

import { cache } from "react"

import { pickPrimaryLocationId } from "@/lib/locations/primary-location"
import { listLocationDirectoryRows } from "@/lib/server/location-directory"
import { getSession } from "@/lib/server/session"

export type PrimaryLocation = {
  locationId: string | null
  locationName: string | null
  locationCount: number
}

const EMPTY: PrimaryLocation = {
  locationId: null,
  locationName: null,
  locationCount: 0,
}

/**
 * The location the flat single-business UI acts on.
 *
 * `cache()`-wrapped so the (business) layout, the page inside it, and the
 * dashboard layout's nav all share ONE query and one getSession() per request
 * — getSession writes (app_session.last_seen_at), so uncached fan-out would
 * turn every render into several writes.
 *
 * Returns a zero count rather than throwing when there is no session or no
 * location: "nothing connected yet" is a real 200 state with a connect CTA,
 * not a 404. Flat routes take no location id from the user, so there is
 * nothing here that could be "not found".
 */
export const resolvePrimaryLocation = cache(
  async (): Promise<PrimaryLocation> => {
    const session = await getSession()
    if (!session) return EMPTY

    const rows = await listLocationDirectoryRows(session)
    if (rows.length === 0) return EMPTY

    const candidates = rows.map((row) => ({
      id: row.locationId,
      name: row.name,
      linked: row.linkId !== null,
    }))
    const locationId = pickPrimaryLocationId(candidates)
    const primary = candidates.find((c) => c.id === locationId) ?? null

    return {
      locationId,
      locationName: primary?.name ?? null,
      locationCount: rows.length,
    }
  }
)
