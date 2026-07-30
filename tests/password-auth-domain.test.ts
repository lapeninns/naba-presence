import { describe, expect, it } from "vitest"

import {
  emailSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
} from "@/lib/domain/auth"

describe("email and password input policy", () => {
  it("normalises email addresses", () => {
    expect(emailSchema.parse("  Owner@Example.COM ")).toBe(
      "owner@example.com"
    )
  })

  it("requires a long password with a letter, number, and symbol", () => {
    expect(passwordSchema.safeParse("short!1").success).toBe(false)
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false)
    expect(passwordSchema.safeParse("123456789012!").success).toBe(false)
    expect(passwordSchema.safeParse("Valid password!42").success).toBe(true)
  })

  it("allows existing users to sign in with a legacy provider-valid password", () => {
    expect(
      loginSchema.safeParse({
        email: "owner@example.com",
        password: "provider-valid",
      }).success
    ).toBe(true)
  })

  it("applies the strong policy to new registrations", () => {
    expect(
      registerSchema.safeParse({
        displayName: "Owner",
        email: "owner@example.com",
        password: "weak password",
      }).success
    ).toBe(false)
  })
})
