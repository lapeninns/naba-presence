import { describe, expect, it } from "vitest"
import { merchantVerificationState, verificationStatePage } from "@/lib/domain/google-verification-state"

const location = "locations/state-fixture"
describe("independent verification observations", () => {
  it.each([
    ["PENDING", "pending"], ["COMPLETED", "completed"], ["FAILED", "failed"],
    ["STATE_UNSPECIFIED", "unknown"], ["FUTURE_STATE", "unknown"],
  ])("maps provider %s to %s without converting request state into merchant standing", (state, phase) => {
    const result = verificationStatePage({ verifications: [{ name: `${location}/verifications/one`, method: "FUTURE_METHOD", state, pin: "secret", token: "secret", context: { address: "secret" } }] }, location)
    expect(result?.verifications[0]).toEqual({ name: `${location}/verifications/one`, method: "FUTURE_METHOD", providerState: state, phase, createTime: null })
    expect(JSON.stringify(result)).not.toContain("secret")
  })
  it("preserves missing fields as unknown and accepts an empty history", () => {
    expect(verificationStatePage({}, location)).toEqual({ verifications: [], nextPageToken: null })
    expect(verificationStatePage({ verifications: [{ name: `${location}/verifications/one` }] }, location)?.verifications[0]).toMatchObject({ method: null, providerState: null, phase: "unknown", createTime: null })
  })
  it.each([
    { verifications: [{}] }, { verifications: [{ name: "locations/foreign/verifications/one" }] },
    { verifications: [{ name: `${location}/verifications/one`, createTime: "invalid" }] },
    { verifications: "unreadable" }, { nextPageToken: 123 },
  ])("rejects unreadable or incorrectly scoped verification history %j", (value) => {
    expect(verificationStatePage(value, location)).toBeNull()
  })
  it.each([
    [{ hasVoiceOfMerchant: true, hasBusinessAuthority: false }, "none"],
    [{ waitForVoiceOfMerchant: {} }, "wait"], [{ verify: { hasPendingVerification: false } }, "verify"],
    [{ resolveOwnershipConflict: {} }, "ownership_conflict"], [{ complyWithGuidelines: { recommendationReason: "secret" } }, "guidelines"],
    [{ futureAction: {} }, "unknown"],
  ])("projects known merchant actions without private payload echoes %j", (value, action) => {
    const result = merchantVerificationState(value)
    expect(result?.action).toBe(action)
    expect(JSON.stringify(result)).not.toContain("secret")
  })
  it("keeps absent merchant booleans unknown", () => {
    expect(merchantVerificationState({})).toEqual({ hasVoiceOfMerchant: null, hasBusinessAuthority: null, action: "unknown", hasPendingVerification: null })
  })
  it.each([{ hasVoiceOfMerchant: "true" }, { verify: {}, waitForVoiceOfMerchant: {} }, { hasVoiceOfMerchant: true, verify: {} }])("rejects malformed or contradictory merchant states %j", (value) => {
    expect(merchantVerificationState(value)).toBeNull()
  })
})
