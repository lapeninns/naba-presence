import { describe, expect, it } from "vitest"

import {
  emailSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/domain/auth"
import { passwordLength } from "@/lib/domain/auth-limits"

describe("email and password input policy", () => {
  it("normalises email addresses", () => {
    expect(emailSchema.parse("  Owner@Example.COM ")).toBe("owner@example.com")
  })

  it("requires 12 to 128 characters and nothing else (NIST SP 800-63B)", () => {
    expect(passwordSchema.safeParse("short!1").success).toBe(false)
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false)
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true)
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true)
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false)
    // No composition rules: letters only, digits only and symbols only pass.
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(true)
    expect(passwordSchema.safeParse("123456789012").success).toBe(true)
    expect(passwordSchema.safeParse("!!!!!!!!!!!!").success).toBe(true)
    expect(passwordSchema.safeParse("Valid password!42").success).toBe(true)
  })

  it("counts code points, not UTF-16 code units (NIST SP 800-63B)", () => {
    // One emoji is one character to a person and to NIST, but two code units
    // to String.length, so six of them must not pass a 12-character minimum.
    const rocket = "🚀"
    expect(rocket.length).toBe(2)
    expect(passwordLength(rocket.repeat(6))).toBe(6)
    expect(passwordSchema.safeParse(rocket.repeat(6)).success).toBe(false)
    expect(passwordSchema.safeParse(rocket.repeat(11)).success).toBe(false)
    expect(passwordSchema.safeParse(rocket.repeat(12)).success).toBe(true)
    expect(passwordSchema.safeParse("a".repeat(11) + rocket).success).toBe(true)
    // The maximum is in code points too: 128 emoji (256 code units) pass,
    // 129 don't.
    expect(passwordSchema.safeParse(rocket.repeat(128)).success).toBe(true)
    expect(passwordSchema.safeParse(rocket.repeat(129)).success).toBe(false)
    expect(passwordSchema.safeParse("a".repeat(127) + rocket).success).toBe(
      true
    )
    // The short failure still says what to do.
    expect(
      passwordSchema.safeParse(rocket.repeat(6)).error?.issues[0]?.message
    ).toBe("Use at least 12 characters.")
    expect(
      passwordSchema.safeParse(rocket.repeat(129)).error?.issues[0]?.message
    ).toBe("Use no more than 128 characters.")
  })

  it("applies the code-point minimum to registration and reset", () => {
    const sixEmoji = "🚀".repeat(6)
    expect(
      registerSchema.safeParse({
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        password: sixEmoji,
      }).success
    ).toBe(false)
    expect(
      resetPasswordSchema.safeParse({
        tokenHash: "h".repeat(40),
        password: sixEmoji,
      }).success
    ).toBe(false)
    expect(
      resetPasswordSchema.safeParse({
        tokenHash: "h".repeat(40),
        password: "🚀".repeat(12),
      }).success
    ).toBe(true)
  })

  it("accepts a passphrase with spaces", () => {
    expect(passwordSchema.safeParse("correct horse battery").success).toBe(true)
  })

  it("names the length rule in its messages", () => {
    const tooShort = passwordSchema.safeParse("short!1")
    expect(
      tooShort.success ? [] : tooShort.error.issues.map((i) => i.message)
    ).toEqual(["Use at least 12 characters."])
    const tooLong = passwordSchema.safeParse("a".repeat(129))
    expect(
      tooLong.success ? [] : tooLong.error.issues.map((i) => i.message)
    ).toEqual(["Use no more than 128 characters."])
  })

  it("allows existing users to sign in with a legacy provider-valid password", () => {
    expect(
      loginSchema.safeParse({
        email: "owner@example.com",
        password: "provider-valid",
      }).success
    ).toBe(true)
  })

  it("applies the length policy to new registrations", () => {
    expect(
      registerSchema.safeParse({
        displayName: "Owner",
        email: "owner@example.com",
        password: "too short",
      }).success
    ).toBe(false)
  })
})
