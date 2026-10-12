import type { SettingsCapabilitiesResponse } from "@/lib/contracts/location-capabilities"
import {
  NO_SETTINGS_FEATURES,
  readSettingsFeatures,
  settingsCapabilities,
  settingsFeaturesApply,
} from "@/lib/server/capabilities"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session, tenant }) =>
    ({
      capabilities: settingsCapabilities(
        session,
        settingsFeaturesApply(session)
          ? await tenant((sql) => readSettingsFeatures(sql, session))
          : NO_SETTINGS_FEATURES
      ),
    }) satisfies SettingsCapabilitiesResponse,
})
