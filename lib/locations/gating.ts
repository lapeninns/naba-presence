export type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }

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

// Posts drafting is blocked whenever posts writes are off (the routes 503
// posts_paused on POST/PATCH). Conservative but honest for the default all-off.
export function composeDisabledReason(writesEnabled: boolean): string | null {
  return writesEnabled ? null : "Google posts are currently paused, so new posts cannot be composed."
}
