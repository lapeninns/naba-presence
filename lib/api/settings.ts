import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export const orgSettingsSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean(),
  rawContentRetentionDays: z.number(),
  defaultLanguageCode: z.string(),
  defaultTimezone: z.string(),
  directPublishConsentAt: z.string().nullable(),
})

const settingsResponseSchema = z.object({ settings: orgSettingsSchema })

export type OrgSettings = z.infer<typeof orgSettingsSchema>

export type SettingsPatchInput = {
  approvalRequired: boolean
  requireTwoPersonApproval?: boolean
  rawContentRetentionDays: number
  defaultLanguageCode: string
  defaultTimezone: string
  directPublishConsent: boolean
}

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
