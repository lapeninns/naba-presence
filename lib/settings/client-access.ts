import {
  UNFILED_CLIENT_ID,
  type ClientAccessRow,
  type ClientPublishing,
} from "@/lib/contracts/client-access"
import type { MemberRole } from "@/lib/settings/forms/invitation"

/**
 * Client-level access, worked out from per-listing grants.
 *
 * Pure and client-safe: the route (lib/server/client-access.ts) and the Team
 * screens share it, so what Team says and what the server saves are the
 * same arithmetic. Nothing here decides visibility — lib/server/permissions.ts
 * does, from location_member rows. This only groups those rows by client and
 * turns a client-level request back into rows.
 */

/** One location_member row, with the client its listing is filed under. */
export type AccessGrant = {
  locationId: string
  /** null: the listing is not filed under any client. */
  clientId: string | null
  canPublish: boolean
}

/** A client (or the unfiled group) and how many listings it holds now. */
export type ClientTotal = {
  clientId: string
  name: string
  archived?: boolean
  total: number
}

/** A client (or the unfiled group) and the ids of its listings now. */
export type ClientCatalogueEntry = {
  clientId: string
  name: string
  archived?: boolean
  listingIds: string[]
}

export type ClientAccessSummary = {
  allClients: boolean
  clients: ClientAccessRow[]
}

function isManagerial(role: MemberRole) {
  return role === "owner" || role === "admin"
}

function publishingOf(grants: AccessGrant[]): ClientPublishing {
  if (grants.length === 0) return "none"
  const publishing = grants.filter((grant) => grant.canPublish).length
  if (publishing === grants.length) return "all"
  return publishing === 0 ? "none" : "some"
}

/**
 * Group a member's rows by client. `clients` sets the order and the set of
 * rows returned (pass the unfiled group as `UNFILED_CLIENT_ID` when it has
 * listings). A member with no rows at all is `allClients`.
 */
export function summariseClientAccess(
  grants: AccessGrant[],
  clients: ClientTotal[]
): ClientAccessSummary {
  const byClient = new Map<string, AccessGrant[]>()
  for (const grant of grants) {
    const key = grant.clientId ?? UNFILED_CLIENT_ID
    byClient.set(key, [...(byClient.get(key) ?? []), grant])
  }
  return {
    allClients: grants.length === 0,
    clients: clients.map((client) => {
      const held = byClient.get(client.clientId) ?? []
      return {
        clientId: client.clientId,
        name: client.name,
        archived: client.archived ?? false,
        total: client.total,
        granted: held.length,
        publishing: publishingOf(held),
      }
    }),
  }
}

function listings(count: number) {
  return `${count} ${count === 1 ? "listing" : "listings"}`
}

/**
 * The Team row's "Client access" cell: "All clients", "Old Crown",
 * "2 clients", or "Old Crown (3 of 5 listings)" when older per-listing grants
 * hold only part of a client.
 */
export function describeMemberAccess(
  role: MemberRole,
  summary: ClientAccessSummary
): { label: string; detail: string | null } {
  if (isManagerial(role)) {
    return { label: "All clients", detail: null }
  }
  if (summary.allClients) {
    return { label: "All clients", detail: "Including clients added later" }
  }
  const held = summary.clients.filter((client) => client.granted > 0)
  const partial = held.filter((client) => client.granted < client.total)
  if (held.length === 0) {
    // Rows exist but none of them match a listed client (a listing moved or
    // was removed between reads). Still scoped; say so rather than guess.
    return { label: "Some listings", detail: "Assigned per listing" }
  }
  if (held.length === 1) {
    const only = held[0]
    return only.granted < only.total
      ? {
          label: `${only.name} (${only.granted} of ${listings(only.total)})`,
          detail: "Some listings",
        }
      : { label: only.name, detail: listings(only.total) }
  }
  const names = held.slice(0, 3).map((client) => client.name)
  const more = held.length - names.length
  const detail = `${names.join(", ")}${more > 0 ? ` +${more} more` : ""}`
  return {
    label: `${held.length} clients`,
    detail:
      partial.length > 0
        ? `${detail} · some listings in ${partial.length === 1 ? partial[0].name : `${partial.length} of them`}`
        : detail,
  }
}

// ---------------------------------------------------------------------------
// Turning a client-level request into rows
// ---------------------------------------------------------------------------

export type ClientAccessRequest =
  | { allClients: true }
  | {
      clients: {
        clientId: string
        listings?: "all" | "unchanged"
        canPublish?: boolean
      }[]
    }

export type ClientAccessPlan =
  | {
      ok: true
      allClients: boolean
      rows: { locationId: string; canPublish: boolean }[]
    }
  | { ok: false; status: number; code: string; message: string }

/**
 * The rows a member should hold after a client-level change, or why the
 * change is refused.
 *
 * THE TRAP this guards: a member or viewer with no location_member rows
 * sees every client (lib/server/permissions.ts). So a request that would
 * leave them with no rows — no clients ticked, or only clients that have no
 * listings — is refused with `would_widen_to_all_clients` instead of saved.
 * "Every client" has to be asked for by name, as `{ allClients: true }`.
 */
export function planClientAccess(input: {
  role: MemberRole
  request: ClientAccessRequest
  catalogue: ClientCatalogueEntry[]
  current: AccessGrant[]
}): ClientAccessPlan {
  const { role, request, catalogue, current } = input
  if (isManagerial(role)) {
    return {
      ok: false,
      status: 409,
      code: "role_sees_all_clients",
      message:
        "Owners and admins always see every client. Change their role to limit what they see.",
    }
  }
  if ("allClients" in request) {
    return { ok: true, allClients: true, rows: [] }
  }

  // Catalogue ids are Postgres' lower-case text; z.uuid() accepts either.
  const ids = request.clients.map((entry) => entry.clientId.toLowerCase())
  if (new Set(ids).size !== ids.length) {
    return {
      ok: false,
      status: 400,
      code: "duplicate_client",
      message: "Each client may be listed once.",
    }
  }
  const byId = new Map(catalogue.map((entry) => [entry.clientId, entry]))
  if (ids.some((id) => !byId.has(id))) {
    return {
      ok: false,
      status: 404,
      code: "client_not_found",
      message: "One or more of those clients was not found.",
    }
  }
  const viewer = role === "viewer"
  if (viewer && request.clients.some((entry) => entry.canPublish)) {
    return {
      ok: false,
      status: 409,
      code: "viewer_cannot_publish",
      message: "Viewers cannot receive publish permission.",
    }
  }

  const held = new Map(current.map((grant) => [grant.locationId, grant]))
  const rows: { locationId: string; canPublish: boolean }[] = []
  for (const entry of request.clients) {
    const client = byId.get(entry.clientId.toLowerCase())!
    for (const locationId of client.listingIds) {
      if (entry.listings === "unchanged") {
        const existing = held.get(locationId)
        if (!existing) continue
        rows.push({
          locationId,
          canPublish: viewer
            ? false
            : (entry.canPublish ?? existing.canPublish),
        })
      } else {
        rows.push({
          locationId,
          canPublish: viewer ? false : (entry.canPublish ?? false),
        })
      }
    }
  }

  if (rows.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "would_widen_to_all_clients",
      message:
        "That leaves them with no listings, and someone with no listings sees every client. Choose at least one client that has listings, or choose All clients.",
    }
  }
  return { ok: true, allClients: false, rows }
}

// ---------------------------------------------------------------------------
// Saying what a change will do, before it is saved
// ---------------------------------------------------------------------------

export type AccessChange = {
  /** The sentence under the choice: what they will see after saving. */
  consequence: string
  /** A widening or narrowing worth a second look, or null. */
  warning: { title: string; body: string } | null
}

/**
 * The consequence line in the Client access dialog, and a warning when the
 * change moves someone between "every client" and "some clients".
 * `selected` is the clients ticked, with the listings each will grant.
 */
export function describeAccessChange(input: {
  name: string
  before: ClientAccessSummary
  allClients: boolean
  selected: { name: string; listings: number }[]
  totalClients: number
}): AccessChange {
  const { name, before, allClients, selected, totalClients } = input
  if (allClients) {
    return {
      consequence: `${name} will see every client and listing, including clients added later.`,
      warning: before.allClients
        ? null
        : {
            title: `This widens ${name}’s access`,
            body: "They will see every client’s reviews and listings, not only the ones chosen now.",
          },
    }
  }
  const granted = selected.filter((client) => client.listings > 0)
  if (granted.length === 0) {
    return {
      consequence: `Choose at least one client. With none, ${name} would see every client, so it can’t be saved that way.`,
      warning: null,
    }
  }
  const count = granted.reduce((sum, client) => sum + client.listings, 0)
  const names = granted.map((client) => client.name)
  const shown =
    names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
  const hidden = Math.max(totalClients - granted.length, 0)
  return {
    consequence: `${name} will see ${granted.length === 1 ? "1 client" : `${granted.length} clients`} (${listings(count)}): ${shown}.${hidden > 0 ? ` The other ${hidden === 1 ? "client is" : `${hidden} clients are`} hidden from them, and so are clients added later.` : " Clients added later stay hidden from them."}`,
    warning: before.allClients
      ? {
          title: `This narrows ${name}’s access`,
          body: "They can see every client now. After saving they see only the clients ticked here.",
        }
      : null,
  }
}
