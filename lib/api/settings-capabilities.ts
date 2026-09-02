import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export const settingsCapabilitiesSchema = z.object({
  canManageTeam: z.boolean(),
  canManageConnections: z.boolean(),
  canEditSettings: z.boolean(),
  canViewCompliance: z.boolean(),
  canManageCompliance: z.boolean(),
})

const responseSchema = z.object({ capabilities: settingsCapabilitiesSchema })

export type SettingsCapabilities = z.infer<typeof settingsCapabilitiesSchema>

export async function fetchSettingsCapabilities(options?: RequestOptions): Promise<SettingsCapabilities> {
  const { capabilities } = await apiFetch("/api/settings/capabilities", {
    schema: responseSchema,
    ...options,
  })
  return capabilities
}
