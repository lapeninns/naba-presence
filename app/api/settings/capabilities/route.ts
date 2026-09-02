import type { SettingsCapabilitiesResponse } from "@/lib/contracts/location-capabilities"
import { settingsCapabilities } from "@/lib/server/capabilities"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: ({ session }) =>
    ({
      capabilities: settingsCapabilities(session),
    }) satisfies SettingsCapabilitiesResponse,
})
