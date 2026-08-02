import { describe, expect, it } from "vitest"

import { invitationFormSchema } from "@/lib/settings/forms/invitation"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"
import { privacyRequestFormSchema } from "@/lib/settings/forms/privacy-request"
import { settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"

describe("settingsPolicyFormSchema (mirror of settings/route.ts settingsSchema)", () => {
  it("accepts a valid policy and defaults directPublishConsent to false", () => {
    const parsed = settingsPolicyFormSchema.parse({
      approvalRequired: true,
      requireTwoPersonApproval: false,
      rawContentRetentionDays: 14,
      defaultLanguageCode: "en-GB",
      defaultTimezone: "Europe/London",
    })
    expect(parsed.directPublishConsent).toBe(false)
  })
  it("rejects an out-of-range retention, a bad language code and an unknown timezone", () => {
    const base = {
      approvalRequired: true,
      rawContentRetentionDays: 14,
      defaultLanguageCode: "en-GB",
      defaultTimezone: "Europe/London",
    }
    expect(settingsPolicyFormSchema.safeParse({ ...base, rawContentRetentionDays: 31 }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, rawContentRetentionDays: 0 }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, defaultLanguageCode: "english" }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, defaultTimezone: "Middle/Earth" }).success).toBe(false)
  })
})

describe("invitationFormSchema (mirror of invitations/route.ts invitationSchema)", () => {
  it("lowercases the email and defaults canPublish to false", () => {
    const parsed = invitationFormSchema.parse({ email: "Chef@Riverside.TEST", role: "member" })
    expect(parsed.email).toBe("chef@riverside.test")
    expect(parsed.canPublish).toBe(false)
  })
  it("rejects a non-email and an unknown role", () => {
    expect(invitationFormSchema.safeParse({ email: "not-an-email", role: "member" }).success).toBe(false)
    expect(invitationFormSchema.safeParse({ email: "a@b.test", role: "superuser" }).success).toBe(false)
  })
})

describe("privacyRequestFormSchema (mirror of privacy/requests createSchema)", () => {
  it("accepts a request with an optional reason", () => {
    expect(
      privacyRequestFormSchema.safeParse({ requestType: "erasure", subjectReference: "guest-4821" }).success
    ).toBe(true)
  })
  it("rejects a short subject and an unknown request type", () => {
    expect(privacyRequestFormSchema.safeParse({ requestType: "erasure", subjectReference: "ab" }).success).toBe(false)
    expect(privacyRequestFormSchema.safeParse({ requestType: "delete", subjectReference: "guest-1" }).success).toBe(false)
  })
})

describe("legalHoldFormSchema (mirror of legal-holds createSchema)", () => {
  it("requires a reason of at least ten characters and a uuid review id", () => {
    expect(
      legalHoldFormSchema.safeParse({ reviewId: "11111111-1111-1111-1111-111111111111", reason: "Litigation pending" }).success
    ).toBe(true)
    expect(legalHoldFormSchema.safeParse({ reviewId: "not-a-uuid", reason: "Litigation pending" }).success).toBe(false)
    expect(
      legalHoldFormSchema.safeParse({ reviewId: "11111111-1111-1111-1111-111111111111", reason: "short" }).success
    ).toBe(false)
  })
})
