import { describe, expect, it } from "vitest"

import type { InvitationDelivery } from "@/lib/contracts/invitations"
import {
  canResendInvitation,
  describeInvitationDelivery,
} from "@/lib/settings/invitation-delivery"

const day = (iso: string) => iso.slice(0, 10)

function delivery(overrides: Partial<InvitationDelivery>): InvitationDelivery {
  return {
    id: "d1",
    kind: "initial",
    status: "pending",
    errorCode: null,
    attempts: 0,
    sentAt: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    ...overrides,
  }
}

describe("describeInvitationDelivery", () => {
  it("claims an email went out only when the provider accepted it", () => {
    const sent = describeInvitationDelivery(
      delivery({ status: "sent", sentAt: "2026-10-11T10:01:00.000Z" }),
      day
    )
    expect(sent).toMatchObject({ tone: "ok", label: "Email sent" })
    expect(sent.detail).toContain("2026-10-11")
    for (const status of ["pending", "failed", "uncertain", "suppressed"] as const) {
      const view = describeInvitationDelivery(delivery({ status }), day)
      expect(view.label).not.toBe("Email sent")
      expect(view.tone).not.toBe("ok")
    }
  })

  it("says why an email was not sent and points at the link", () => {
    expect(
      describeInvitationDelivery(
        delivery({ status: "suppressed", errorCode: "provider_not_configured" }),
        day
      ).detail
    ).toMatch(/isn’t set up.*Copy the link/)
    expect(
      describeInvitationDelivery(
        delivery({
          status: "suppressed",
          errorCode: "invitation_email_rate_limited",
        }),
        day
      ).detail
    ).toMatch(/Too many/)
    expect(
      describeInvitationDelivery(delivery({ status: "failed" }), day)
    ).toMatchObject({ tone: "bad", label: "Email failed" })
    expect(
      describeInvitationDelivery(delivery({ status: "uncertain" }), day).detail
    ).toMatch(/couldn’t confirm/)
  })

  it("tells a retry from a fresh queue, and an old invitation from a failure", () => {
    expect(
      describeInvitationDelivery(
        delivery({ status: "pending", attempts: 2, errorCode: "email_http_503" }),
        day
      ).detail
    ).toMatch(/keep trying/)
    expect(describeInvitationDelivery(null, day).label).toBe("Not emailed")
  })

  it("offers Resend unless a send is still queued", () => {
    expect(canResendInvitation(null)).toBe(true)
    expect(canResendInvitation(delivery({ status: "failed" }))).toBe(true)
    expect(canResendInvitation(delivery({ status: "pending" }))).toBe(false)
  })
})
