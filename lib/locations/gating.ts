export type ResourceCapabilityState =
  | "available"
  | "readOnly"
  | "blocked"
  | "unavailable"

export type ResourceCapability = {
  state: ResourceCapabilityState
  reasonCode?: string
}

export type LocationCapabilities = {
  canEditCanonical: boolean
  canPublish: boolean
  resources?: Record<string, ResourceCapability>
}

const REASON_COPY: Record<string, string> = {
  google_location_not_linked: "Link this location to Google first.",
  permission_denied: "You do not have permission for this section.",
  publishing_paused: "Publishing to Google is currently unavailable.",
  publish_not_allowed: "You do not have permission to publish this location to Google.",
}

export function reasonCodeMessage(reasonCode: string | undefined): string | null {
  if (!reasonCode) return null
  return REASON_COPY[reasonCode] ?? reasonCode.replace(/_/g, " ")
}

// Returns a disabled-state reason string, or null when the control is enabled.
// A missing `caps` means the capability query is still loading -> null (the
// control stays disabled by the caller's own pending state, not a reason).
export function editDisabledReason(caps: LocationCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canEditCanonical ? null : "Only owners and admins can edit this location."
}

export function publishDisabledReason(
  caps: LocationCapabilities | undefined,
  writesEnabled: boolean
): string | null {
  if (!caps) return null
  if (!caps.canPublish) return "You do not have permission to publish this location to Google."
  if (!writesEnabled) return "Publishing to Google is currently unavailable."
  return null
}

/** Prefer per-resource capability state when present; fall back to publish gates. */
export function resourceDisabledReason(
  caps: LocationCapabilities | undefined,
  resourceKey: string,
  writesEnabled: boolean
): string | null {
  if (!caps) return null
  const resource = caps.resources?.[resourceKey]
  if (resource) {
    if (resource.state === "available") return null
    return (
      reasonCodeMessage(resource.reasonCode) ??
      (resource.state === "readOnly"
        ? "This section is read-only right now."
        : resource.state === "unavailable"
          ? "This section is not available for this location."
          : "Changes are blocked for this section.")
    )
  }
  return publishDisabledReason(caps, writesEnabled)
}

export function resourceIsWritable(
  caps: LocationCapabilities | undefined,
  resourceKey: string,
  writesEnabled: boolean
): boolean {
  return resourceDisabledReason(caps, resourceKey, writesEnabled) === null
}

// Posts publish is blocked whenever PUBLISH_ENABLED is off.
export function composeDisabledReason(writesEnabled: boolean): string | null {
  return writesEnabled
    ? null
    : "Publishing to Google is currently unavailable, so new posts cannot be composed."
}
