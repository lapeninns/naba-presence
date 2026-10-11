import type { SettingsCapabilitiesResponse } from "@/lib/contracts/location-capabilities"
import {
  readSettingsFeatures,
  settingsCapabilities,
} from "@/lib/server/capabilities"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session, tenant }) =>
    ({
      capabilities: settingsCapabilities(
        session,
        await tenant((sql) => readSettingsFeatures(sql, session))
      ),
    }) satisfies SettingsCapabilitiesResponse,
})
