import type { GoogleLifecycleBaseline, GoogleLifecycleObservation, GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"

const managers = new Set(["PRIMARY_OWNER", "OWNER", "MANAGER", "SITE_MANAGER"])
const owners = new Set(["PRIMARY_OWNER", "OWNER"])

export function lifecycleBaselineState(baseline: GoogleLifecycleBaseline) {
  const ordered = (inventory: GoogleLifecycleBaseline["source"]) => ({ ...inventory, locations: [...inventory.locations].sort((a, b) => a.name.localeCompare(b.name)) })
  return { location: baseline.location, source: ordered(baseline.source), destination: baseline.destination ? ordered(baseline.destination) : null }
}

function exactInventory(inventory: GoogleLifecycleBaseline["source"], location: GoogleLifecycleBaseline["location"]) {
  return inventory.complete && inventory.locations.filter((row) => row.name === location.name && row.placeId === location.placeId).length === 1
    && new Set(inventory.locations.map((row) => row.name)).size === inventory.locations.length
}

export function lifecyclePreflightReason(request: GoogleLifecycleRequest, baseline: GoogleLifecycleBaseline): string | null {
  if (!managers.has(baseline.source.account.role ?? "")) return "source_access_unknown"
  if (!exactInventory(baseline.source, baseline.location)) return "source_membership_unproven"
  if (request.operation === "delete_location") return baseline.location.canDelete === true ? null : "deletion_eligibility_unproven"
  if (!owners.has(baseline.source.account.role ?? "")) return "source_ownership_required"
  if (request.payload.destinationAccount === baseline.source.account.name) return "destination_matches_source"
  const destination = baseline.destination
  if (!destination || destination.account.name !== request.payload.destinationAccount || !destination.complete) return "destination_access_unproven"
  if (!["PRIMARY_OWNER", "OWNER", "MANAGER"].includes(destination.account.role ?? "")) return "destination_management_required"
  if (destination.locations.some((row) => row.name === baseline.location.name)) return "destination_already_contains_location"
  return null
}

export function lifecycleConfirmation(input: {
  readonly request: GoogleLifecycleRequest
  readonly baseline: GoogleLifecycleBaseline
  readonly observation: GoogleLifecycleObservation
}): "location_transferred_between_accounts" | "location_absent_from_managed_account" | "unresolved" {
  const { request, baseline, observation } = input
  if (lifecyclePreflightReason(request, baseline)) return "unresolved"
  const source = observation.source
  if (source.account.name !== baseline.source.account.name || !source.complete || !managers.has(source.account.role ?? "")) return "unresolved"
  if (source.locations.some((row) => row.name === baseline.location.name)) return "unresolved"
  if (request.operation === "delete_location") return observation.locationRead.state === "not_found" ? "location_absent_from_managed_account" : "unresolved"
  const destination = observation.destination
  if (!destination || destination.account.name !== request.payload.destinationAccount || !managers.has(destination.account.role ?? "")) return "unresolved"
  if (!exactInventory(destination, baseline.location)) return "unresolved"
  if (observation.locationRead.state !== "accessible" || observation.locationRead.location.name !== baseline.location.name || observation.locationRead.location.placeId !== baseline.location.placeId) return "unresolved"
  return "location_transferred_between_accounts"
}
