import {
  settingsCapabilitiesResponseSchema,
  settingsCapabilitiesSchema,
  type SettingsCapabilities,
} from "@/lib/contracts/location-capabilities"

import { apiFetch, type RequestOptions } from "./client"

// The shape lives in lib/contracts/location-capabilities.ts; re-exported for
// existing importers.
export { settingsCapabilitiesSchema }
export type { SettingsCapabilities }

export async function fetchSettingsCapabilities(options?: RequestOptions): Promise<SettingsCapabilities> {
  const { capabilities } = await apiFetch("/api/settings/capabilities", {
    schema: settingsCapabilitiesResponseSchema,
    ...options,
  })
  return capabilities
}
