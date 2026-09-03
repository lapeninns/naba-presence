import type {
  DirectoryRow,
  LocationEntry,
  ManagementLocation,
} from "@/lib/contracts/location-links"

// Pure — deliberately NOT "use client" and NOT "server-only". These mappers
// run on both sides: the client hook maps a fetched payload with them, and the
// dashboard layout maps a directly-queried one with them before hydrating the
// cache. Sharing one implementation is what makes the RSC and HTTP paths
// produce identical objects instead of two shapes that drift.
//
// The row and entry shapes are the wire contract
// (lib/contracts/location-links.ts); `DirectoryRow` is re-exported for the
// existing importers of this module.
export type { DirectoryRow }

export function projectManagement(
  rows: readonly DirectoryRow[]
): ManagementLocation[] {
  return rows.map((row) => ({
    locationId: row.locationId,
    name: row.name,
    address: row.address ?? null,
    timezone: row.timezone,
    linkId: row.linkId,
    externalLocationId: row.externalLocationId,
    googleLocationName: row.googleLocationName,
    googleTitle: row.googleTitle,
    verified: row.verified,
    clientId: row.clientId,
    clientName: row.clientName,
  }))
}

// `linked` goes to every role — resolution ranks on it, and withholding it
// would let a member resolve a different primary than an owner on the same
// org. `googleLocationName` stays owner/admin-only, as it is today.
export function projectDefault(
  rows: readonly DirectoryRow[],
  role: string | null
): LocationEntry[] {
  const management = role === "owner" || role === "admin"
  return rows.map((row) => ({
    id: row.locationId,
    name: row.name,
    linked: row.linkId !== null,
    clientId: row.clientId,
    clientName: row.clientName,
    ...(management ? { googleLocationName: row.googleLocationName } : {}),
  }))
}

// `linked` is required. See the note on locationEntrySchema in
// lib/contracts/location-links.ts — primary-location resolution ranks on it,
// so a payload that could omit it would let two roles resolve different
// primaries silently.
export type DirectoryEntry = {
  id: string
  name: string
  linked: boolean
  address?: unknown
  verified?: boolean
  timezone?: string
  externalLocationId?: string | null
  /** Null while a location is imported but not yet filed under a client. */
  clientId?: string | null
  clientName?: string | null
}

export function toDirectoryEntriesFromManagement(
  locations: readonly ManagementLocation[]
): DirectoryEntry[] {
  return locations.map((l) => ({
    id: l.locationId,
    name: l.name,
    linked: l.linkId !== null,
    address: l.address,
    verified: Boolean(l.verified),
    timezone: l.timezone,
    externalLocationId: l.externalLocationId,
    clientId: l.clientId,
    clientName: l.clientName,
  }))
}

export function toDirectoryEntriesFromDefault(
  locations: readonly LocationEntry[]
): DirectoryEntry[] {
  // No address/verified/timezone/externalLocationId: the default payload
  // withholds them from member and viewer, and inventing defaults here would
  // make a withheld field indistinguishable from a false one.
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    linked: l.linked,
    clientId: l.clientId ?? null,
    clientName: l.clientName ?? null,
  }))
}
