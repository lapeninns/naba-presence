import { describe, expect, it } from "vitest"

import { verificationOptionsInputSchema, verificationStartPayloadSchema, type VerificationChoice } from "@/lib/contracts/google-verification-options"
import { verificationChoiceDetails, verificationDestinationMatches } from "@/lib/domain/google-verification-options"

const address = { regionCode: "GB", addressLines: ["2 High Street"], locality: "London", postalCode: "SW1A 1AA" }
const id = "a".repeat(64)

describe("typed Google verification options", () => {
  it("keeps email editability unknown when Google omits it", () => {
    expect(verificationChoiceDetails({ verificationMethod: "EMAIL", emailData: { user: "owner", domain: "example.test" } })).toEqual({ kind: "email", method: "EMAIL", user: "owner", domain: "example.test", userNameEditable: null })
  })

  it.each(["PHONE_CALL", "SMS"])("represents a complete %s destination separately", (method) => {
    expect(verificationChoiceDetails({ verificationMethod: method, phoneNumber: "+44 20 0000 0001" })).toEqual({ kind: "phone", method, phoneNumber: "+44 20 0000 0001" })
  })

  it("keeps Google's postal address and delivery estimate", () => {
    expect(verificationChoiceDetails({ verificationMethod: "ADDRESS", addressData: { business: "Business", address, expectedDeliveryDaysRegion: 14 } })).toEqual({ kind: "address", method: "ADDRESS", business: "Business", address, expectedDeliveryDays: 14 })
    expect(verificationChoiceDetails({ verificationMethod: "ADDRESS", addressData: { address } })).toMatchObject({ kind: "address", expectedDeliveryDays: null })
  })

  it("supports eligible auto verification without inventing a destination", () => {
    expect(verificationChoiceDetails({ verificationMethod: "AUTO" })).toEqual({ kind: "auto", method: "AUTO" })
  })

  it.each([
    { verificationMethod: "EMAIL" },
    { verificationMethod: "EMAIL", emailData: { user: "***", domain: "example.test" } },
    { verificationMethod: "EMAIL", emailData: { user: "owner", domain: "bad@domain" } },
    { verificationMethod: "SMS", phoneNumber: "+44 **** 001" },
    { verificationMethod: "SMS", phoneNumber: "+" },
    { verificationMethod: "ADDRESS", addressData: { address: { regionCode: "GB" } } },
  ])("turns an unusable destination into a handoff", (option) => {
    expect(verificationChoiceDetails(option)).toMatchObject({ kind: "external", reason: "unusable_destination" })
  })

  it.each([
    { verificationMethod: "EMAIL", emailData: { user: "owner", domain: "example.test" }, phoneNumber: "+44000001" },
    { verificationMethod: "AUTO", futureRestriction: true },
  ])("does not infer support from conflicting or unknown display data", (option) => {
    expect(verificationChoiceDetails(option)).toMatchObject({ kind: "external", reason: "unknown_display_data" })
  })

  it("keeps partner and future methods as distinct external choices", () => {
    expect(verificationChoiceDetails({ verificationMethod: "VETTED_PARTNER", announcement: "Only vetted partners" })).toEqual({ kind: "external", method: "VETTED_PARTNER", reason: "partner_required" })
    expect(verificationChoiceDetails({ verificationMethod: "VIDEO" })).toEqual({ kind: "external", method: "VIDEO", reason: "unknown_method" })
    expect(verificationChoiceDetails({})).toBeNull()
  })

  it("allows editable usernames only on the eligible domain", () => {
    const choice: VerificationChoice = { id, kind: "email", method: "EMAIL", user: "owner", domain: "example.test", userNameEditable: true }
    for (const emailAddress of ["other@example.test", "other@EXAMPLE.TEST"]) {
      expect(verificationDestinationMatches(choice, verificationStartPayloadSchema.parse({ method: "EMAIL", languageCode: "en", emailAddress }))).toBe(true)
    }
    expect(verificationDestinationMatches(choice, verificationStartPayloadSchema.parse({ method: "EMAIL", languageCode: "en", emailAddress: "owner@different.test" }))).toBe(false)
    for (const userNameEditable of [false, null]) {
      expect(verificationDestinationMatches({ ...choice, userNameEditable }, verificationStartPayloadSchema.parse({ method: "EMAIL", languageCode: "en", emailAddress: "other@example.test" }))).toBe(false)
      expect(verificationDestinationMatches({ ...choice, userNameEditable }, verificationStartPayloadSchema.parse({ method: "EMAIL", languageCode: "en", emailAddress: "owner@example.test" }))).toBe(true)
    }
  })

  it("requires an exact offered phone number and method", () => {
    const choice: VerificationChoice = { id, kind: "phone", method: "SMS", phoneNumber: "+44 20 0000 0001" }
    expect(verificationDestinationMatches(choice, verificationStartPayloadSchema.parse({ method: "SMS", languageCode: "en", phoneNumber: choice.phoneNumber }))).toBe(true)
    expect(verificationDestinationMatches(choice, verificationStartPayloadSchema.parse({ method: "SMS", languageCode: "en", phoneNumber: "+442000000001" }))).toBe(false)
    expect(verificationDestinationMatches(choice, verificationStartPayloadSchema.parse({ method: "PHONE_CALL", languageCode: "en", phoneNumber: choice.phoneNumber }))).toBe(false)
  })

  it.each([
    { method: "EMAIL", languageCode: "en" },
    { method: "EMAIL", languageCode: "en", emailAddress: "invalid" },
    { method: "SMS", languageCode: "en", emailAddress: "owner@example.test" },
    { method: "ADDRESS", languageCode: "en", mailerContact: " " },
    { method: "AUTO", languageCode: "en", phoneNumber: "+440001" },
    { method: "VETTED_PARTNER", languageCode: "en", token: { tokenString: "secret" } },
    { method: "VIDEO", languageCode: "en" },
  ])("rejects an incomplete or mismatched method input", (payload) => {
    expect(verificationStartPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it("parses postal contact and private service context without silently dropping fields", () => {
    const payload = { method: "ADDRESS", languageCode: "en-GB", mailerContact: "Owner", context: { address } }
    expect(verificationStartPayloadSchema.parse(payload)).toEqual(payload)
    expect(verificationOptionsInputSchema.safeParse({ context: { address: { ...address, unknownField: "extra" } } }).success).toBe(false)
    expect(verificationOptionsInputSchema.safeParse({ languageCode: "invalid_language" }).success).toBe(false)
    expect(verificationOptionsInputSchema.parse({})).toEqual({ languageCode: "en" })
  })
})
