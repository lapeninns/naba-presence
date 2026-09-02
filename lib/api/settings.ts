import { apiFetch, type RequestOptions } from "./client"
import {
  settingsResponseSchema,
  type OrgSettings,
  type SettingsPatchInput,
} from "@/lib/contracts/settings"

export { orgSettingsSchema } from "@/lib/contracts/settings"
export type { OrgSettings, SettingsPatchInput }

export async function fetchSettings(options?: RequestOptions): Promise<OrgSettings> {
  const { settings } = await apiFetch("/api/settings", {
    schema: settingsResponseSchema,
    ...options,
  })
  return settings
}

export async function saveSettings(input: SettingsPatchInput): Promise<OrgSettings> {
  const { settings } = await apiFetch("/api/settings", {
    method: "PATCH",
    body: input,
    schema: settingsResponseSchema,
  })
  return settings
}
