import { describe, expect, it } from "vitest"

import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { prepareVerificationCompletion, recordedVerificationResponse, verificationFailure } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"

describe("transient Google verification credentials", () => {
  it("keeps leading zeroes in a PIN and scopes its name to the selected listing", () => {
    expect(prepareVerificationCompletion({ name: "locations/one/verifications/request", pin: "001234" }, "locations/one")).toEqual({ name: "locations/one/verifications/request", pin: "001234" })
    expect(() => prepareVerificationCompletion({ name: "locations/one-other/verifications/request", pin: "001234" }, "locations/one")).toThrow(ApiError)
  })

  it("retains only defined verification identity and state fields in both response shapes", () => {
    const verification = { name: "locations/one/verifications/request", method: "ADDRESS", state: "PENDING", createTime: "2026-09-30T00:00:00.123456789Z" }
    expect(recordedVerificationResponse({ ...verification, pin: "secret", announcement: "secret" })).toEqual(verification)
    expect(recordedVerificationResponse({ verification: { ...verification, token: { tokenString: "secret" } }, pin: "secret" })).toEqual({ verification })
  })

  it.each([{ verification: { state: "secret" } }, { verification: { name: "foreign-path" } }, { verification: { createTime: "secret" } }, null])("makes malformed provider status ambiguous without exposing its contents", (response) => {
    expect(() => recordedVerificationResponse(response)).toThrow(GoogleMutationAmbiguousError)
  })

  it("preserves PIN rejection classification without provider messages or details", () => {
    const error = verificationFailure(new ApiError(400, "INVALID_ARGUMENT", "secret PIN", { details: { pin: "secret" } }))
    expect(error.code).toBe("INVALID_ARGUMENT")
    expect(error.status).toBe(400)
    expect(error.message).not.toContain("secret")
    expect(error.details).toBeUndefined()
  })

  it("replaces arbitrary provider error codes and marks uncertain transport outcomes", () => {
    expect(verificationFailure(new ApiError(400, "secret", "secret")).code).toBe("google_verification_failed")
    for (const error of [new GoogleMutationAmbiguousError("secret"), new TypeError("secret")]) {
      const failure = verificationFailure(error)
      expect(failure).toBeInstanceOf(GoogleMutationAmbiguousError)
      expect(failure.message).not.toContain("secret")
    }
  })
})
