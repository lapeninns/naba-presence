import { describe, expect, it } from "vitest"

import { reviewNotificationPath } from "@/lib/notifications/links"
import {
  renderDigestEmail,
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

  it("sends approval emails to the review in the Inbox, not the listing", () => {
    const reviewId = "33333333-3333-4333-8333-333333333333"
    const summary = {
      title: "The White Horse",
      locationId: "11111111-1111-4111-8111-111111111111",
      reviewId,
    }
    const request = renderIncidentEmail("approval_requested", summary, APP)
    expect(request.subject).toBe(
      "Approval requested: The White Horse"
    )
    expect(linkLine(request.text, "Open")).toBe(
      `${APP}/inbox?queue=approval&selected=${reviewId}`
    )
    const sentBack = renderIncidentEmail("reply_sent_back", summary, APP)
    expect(sentBack.subject).toBe("Reply sent back: The White Horse")
    expect(sentBack.text).toContain("It was not sent to Google.")
    expect(linkLine(sentBack.text, "Open")).toBe(
      `${APP}/inbox?selected=${reviewId}`
    )
    // No review text, reviewer or person's name: the summary holds none.
    expect(renderDigestEmail([{ kind: "reply_sent_back", summary }], APP).text)
      .toContain("- Reply sent back: The White Horse")
  })

  it("links only the approval kinds to a review, and only by a well-formed id", () => {
    const reviewId = "33333333-3333-4333-8333-333333333333"
    expect(reviewNotificationPath("approval_requested", { reviewId })).toBe(
      `/inbox?queue=approval&selected=${reviewId}`
    )
    expect(reviewNotificationPath("reply_sent_back", { reviewId })).toBe(
      `/inbox?selected=${reviewId}`
    )
    expect(reviewNotificationPath("publication_failed", { reviewId })).toBe(
      null
    )
    expect(reviewNotificationPath("reply_sent_back", {})).toBe(null)
    expect(
      reviewNotificationPath("reply_sent_back", { reviewId: "../settings" })
    ).toBe(null)
    // Without a review id the email falls back to the listing.
    expect(
      linkLine(
        renderIncidentEmail(
          "reply_sent_back",
          { locationId: "11111111-1111-4111-8111-111111111111" },
          APP
        ).text,
        "Open"
      )
    ).toBe(`${APP}/listings/11111111-1111-4111-8111-111111111111`)
  })
})
