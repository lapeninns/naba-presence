import type {
  LocationCapabilities,
  ResourceCapability,
  ResourceCapabilityState,
} from "@/lib/contracts/location-capabilities"

// The capability shape is the wire contract; re-exported so the tab
// components keep one import site for both the evaluators and their input.
export type { LocationCapabilities, ResourceCapability, ResourceCapabilityState }

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

// --- LocationTab shell helpers (Sprint 4.1) --------------------------------
// Pure evaluators consumed by components/locations/location-tab.tsx. Kept here
// so the shell stays a thin renderer and the rules are unit-testable without
// React.

/** A capability flag a whole tab can require before its resource query fires. */
export type LocationGate = "canEditCanonical" | "canPublish"

/** Default notice title for a tab whose `requires` gate is not satisfied. */
export const GATED_SECTION_TITLE = "This section is available to owners and admins"

/**
 * True only when the capability is known AND set. `caps` is undefined while
 * the capabilities query is pending (or failed), which reads as "not satisfied"
 * — never a false positive — so an owner/admin-only GET is never fired before
 * the role is known.
 */
export function gateSatisfied(
  caps: LocationCapabilities | undefined,
  gate: LocationGate | undefined
): boolean {
  if (!gate) return true
  return caps?.[gate] === true
}

export type TabGateReasons = {
  /** `editReason !== null` — canonical editors should be disabled. */
  disabled: boolean
  /** Why canonical editing is blocked, or null. */
  editReason: string | null
  /** Why writing/publishing this resource to Google is blocked, or null. */
  publishReason: string | null
}

/**
 * The `{ disabled, editReason, publishReason }` triple every tab used to derive
 * by hand. With a `resourceKey` the per-resource capability state wins
 * (`resourceDisabledReason`); without one it falls back to the plain publish
 * gate (`publishDisabledReason`). `publishReason` is the resource gate only —
 * tabs that want "cannot edit" to also block publishing compose
 * `editReason ?? publishReason` themselves.
 */
export function tabGateReasons(
  caps: LocationCapabilities | undefined,
  resourceKey: string | undefined,
  writesEnabled: boolean
): TabGateReasons {
  const editReason = editDisabledReason(caps)
  const publishReason = resourceKey
    ? resourceDisabledReason(caps, resourceKey, writesEnabled)
    : publishDisabledReason(caps, writesEnabled)
  return { disabled: editReason !== null, editReason, publishReason }
}
