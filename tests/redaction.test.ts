import { describe, expect, it } from "vitest"

import { redactForLog } from "@/lib/domain/redaction"

describe("structured log redaction", () => {
  it("redacts verification PIN field variants without hiding unrelated pinning fields", () => {
    expect(redactForLog({ pin: "001234", PIN_CODE: "001234", verificationPin: "001234", nested: { verification_pin_code: "001234", pinCode: "001234", pinned: true, spinning: "visible" } })).toEqual({ pin: "[REDACTED]", PIN_CODE: "[REDACTED]", verificationPin: "[REDACTED]", nested: { verification_pin_code: "[REDACTED]", pinCode: "[REDACTED]", pinned: true, spinning: "visible" } })
  })
  it("redacts credential-shaped object fields recursively", () => {
    expect(
      redactForLog({
        access_token: "access-secret",
        nested: { clientSecret: "client-secret", okay: "visible" },
      })
    ).toEqual({
      access_token: "[REDACTED]",
      nested: { clientSecret: "[REDACTED]", okay: "visible" },
    })
  })

  it("redacts bearer values and JWTs embedded in messages", () => {
    const result = redactForLog(
      "Authorization failed for Bearer abc.def-123 and eyJabcdefghij.payload.signature"
    )
    expect(result).not.toContain("abc.def-123")
    expect(result).not.toContain("eyJabcdefghij")
  })

  it("serialises errors without stack traces", () => {
    expect(redactForLog(new Error("Bearer very-secret"))).toEqual({
      name: "Error",
      message: "Bearer [REDACTED]",
    })
  })
})
