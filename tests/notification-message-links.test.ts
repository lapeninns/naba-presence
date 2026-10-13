import { describe, expect, it } from "vitest"

import {
  renderIncidentEmail,
  usageSettingsPath,
} from "@/lib/server/notifications/messages"

const APP = "https://app.example"
const CREDIT_KINDS = ["ai_credits_low", "ai_credits_exhausted"] as const

// The one line of an email that carries its link, by its label.
function linkLine(text: string, label: string): string | undefined {
  return text
    .split("\n")
    .find((line) => line.startsWith(`${label}: `))
    ?.slice(label.length + 2)
}

describe("notification email links", () => {
  it("sends credit emails to the Usage screen when billing is on", () => {
    for (const kind of CREDIT_KINDS) {
      const { text } = renderIncidentEmail(kind, {}, APP, {
        billingEnabled: true,
      })
      expect(linkLine(text, "Usage")).toBe(`${APP}/settings/usage`)
    }
  })

  it("sends credit emails to Reply policy, where the credits card is, when billing is off", () => {
    for (const kind of CREDIT_KINDS) {
      for (const { text } of [
        renderIncidentEmail(kind, {}, APP, { billingEnabled: false }),
        // Billing is off unless the deployment says otherwise.
        renderIncidentEmail(kind, {}, APP),
      ]) {
        expect(linkLine(text, "Usage")).toBe(`${APP}/settings/policy`)
      }
    }
  })

  it("never links a bare /settings, which is the settings index on a phone", () => {
    for (const billingEnabled of [true, false]) {
      for (const kind of [
        ...CREDIT_KINDS,
        "connection_reconnect",
        "listing_access_lost",
        "listing_stale",
        "low_rating_review",
        "mutation_unconfirmed",
        "connection_owner_left",
      ] as const) {
        const { text } = renderIncidentEmail(kind, {}, APP, { billingEnabled })
        expect(text).not.toMatch(/\/settings(\s|$)/m)
      }
    }
  })

  it("keeps the connection links on Google connections", () => {
    const { text } = renderIncidentEmail("connection_reconnect", {}, APP)
    expect(linkLine(text, "Reconnect")).toBe(`${APP}/settings/connections`)
  })

  it("names the usage path by billing", () => {
    expect(usageSettingsPath(true)).toBe("/settings/usage")
    expect(usageSettingsPath(false)).toBe("/settings/policy")
  })
})
