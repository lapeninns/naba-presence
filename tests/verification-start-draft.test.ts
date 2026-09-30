import { describe, expect, it } from "vitest"
import type { VerificationChoice } from "@/lib/contracts/google-verification-options"
import { verificationChoiceDestination, verificationStartDraft } from "@/lib/locations/forms/verification"

const id = "a".repeat(64), input = { languageCode: "en-GB" }, draft = { emailUser: "changed", mailerContact: "  Front desk  " }
describe("verification start destination draft", () => {
  it.each([false, null])("preserves the offered username when edit eligibility is %s", (userNameEditable) => {
    const choice = { id, kind: "email", method: "EMAIL", user: "offered", domain: "example.test", userNameEditable } as const
    expect(verificationStartDraft(choice, input, draft)).toEqual({ languageCode: "en-GB", method: "EMAIL", emailAddress: "offered@example.test" })
  })
  it("edits only the eligible username and retains the domain", () => {
    const choice = { id, kind: "email", method: "EMAIL", user: "offered", domain: "example.test", userNameEditable: true } as const
    expect(verificationStartDraft(choice, input, draft)).toMatchObject({ emailAddress: "changed@example.test" })
    expect(verificationStartDraft(choice, input, { ...draft, emailUser: "injected@other.test" })).toBeNull()
  })
  it.each(["SMS", "PHONE_CALL"] as const)("uses the exact offered %s destination", (method) => {
    expect(verificationStartDraft({ id, kind: "phone", method, phoneNumber: "+44 20 1234 5678" }, input, draft)).toMatchObject({ method, phoneNumber: "+44 20 1234 5678" })
  })
  it("requires a bounded postal contact and preserves private context fields", () => {
    const choice = { id, kind: "address", method: "ADDRESS", business: "Camden Hotel", address: { regionCode: "GB", addressLines: ["1 Test Street"] }, expectedDeliveryDays: 14 } as const satisfies VerificationChoice
    const context = { address: { regionCode: "GB", addressLines: ["2 Private Street"], sortingCode: "123", recipients: ["Operations"] } }
    expect(verificationStartDraft(choice, { ...input, context }, draft)).toEqual({ ...input, context, method: "ADDRESS", mailerContact: "Front desk" })
    expect(verificationStartDraft(choice, input, { ...draft, mailerContact: "  " })).toBeNull()
    expect(verificationStartDraft(choice, input, { ...draft, mailerContact: "x".repeat(201) })).toBeNull()
    expect(verificationChoiceDestination(choice)).toContain("1 Test Street")
  })
  it("permits AUTO without inventing a destination but never submits an external method", () => {
    expect(verificationStartDraft({ id, kind: "auto", method: "AUTO" }, input, draft)).toEqual({ ...input, method: "AUTO" })
    expect(verificationStartDraft({ id, kind: "external", method: "VETTED_PARTNER", reason: "partner_required" }, input, draft)).toBeNull()
  })
})
