import { describe, expect, it } from "vitest"

import { mfaVerifySchema, totpCodeSchema } from "@/lib/contracts/auth"
import {
  MFA_PROOF_MINUTES,
  parseProviderAssurance,
  signInCompletionSchema,
  verifiedAssurance,
} from "@/lib/server/mfa"
import { qrCodeDataUri, verifiedTotpFactors } from "@/lib/server/password-auth"

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${part({ alg: "HS256" })}.${part(claims)}.signature`
}

describe("parseProviderAssurance", () => {
  it("reads aal2 and the methods from a verified token", () => {
    expect(
      parseProviderAssurance(
        jwt({
          aal: "aal2",
          amr: [
            { method: "totp", timestamp: 1 },
            { method: "password", timestamp: 0 },
          ],
        })
      )
    ).toEqual({ aal: "aal2", methods: ["totp", "password"] })
  })

  it("treats a password token as aal1", () => {
    expect(
      parseProviderAssurance(
        jwt({ aal: "aal1", amr: [{ method: "password" }] })
      )
    ).toEqual({ aal: "aal1", methods: ["password"] })
  })

  it.each([
    ["no claims", "opaque-token"],
    ["unreadable claims", "a.!!!.c"],
    ["an unknown level", jwt({ aal: "aal3" })],
    [
      "a non-object payload",
      jwt(["aal2"] as unknown as Record<string, unknown>),
    ],
  ])("falls back to aal1 for %s", (_label, token) => {
    expect(parseProviderAssurance(token).aal).toBe("aal1")
  })
})

describe("verifiedAssurance", () => {
  it("records the factor and a proof that lasts fifteen minutes", () => {
    const now = new Date("2026-10-11T10:00:00.000Z")
    expect(
      verifiedAssurance({ factorId: "factor-1", authMethod: "password", now })
    ).toEqual({
      aal: "aal2",
      factorId: "factor-1",
      verifiedAt: now,
      proofExpiresAt: new Date("2026-10-11T10:15:00.000Z"),
      authMethod: "password",
    })
    expect(MFA_PROOF_MINUTES).toBe(15)
  })
})

describe("verifiedTotpFactors", () => {
  it("keeps only verified TOTP factors", () => {
    expect(
      verifiedTotpFactors({
        id: "user-1",
        factors: [
          {
            id: "a",
            factor_type: "totp",
            status: "verified",
            friendly_name: "Phone",
          },
          { id: "b", factor_type: "totp", status: "unverified" },
          { id: "c", factor_type: "phone", status: "verified" },
          {
            id: "d",
            factor_type: "totp",
            status: "verified",
            friendly_name: null,
          },
        ],
      })
    ).toEqual([
      { id: "a", friendlyName: "Phone" },
      { id: "d", friendlyName: null },
    ])
  })

  it("is empty for a user who never enrolled or an unreadable payload", () => {
    expect(verifiedTotpFactors({ id: "user-1" })).toEqual([])
    expect(verifiedTotpFactors({ id: "user-1", factors: null })).toEqual([])
    expect(verifiedTotpFactors("nonsense")).toEqual([])
  })
})

describe("qrCodeDataUri", () => {
  it("passes an image data URI through", () => {
    expect(qrCodeDataUri("data:image/svg+xml;utf-8,<svg/>")).toBe(
      "data:image/svg+xml;utf-8,<svg/>"
    )
  })

  it("wraps bare SVG markup", () => {
    expect(qrCodeDataUri("<svg xmlns='x'></svg>")).toBe(
      `data:image/svg+xml;utf-8,${encodeURIComponent("<svg xmlns='x'></svg>")}`
    )
  })

  it("refuses anything else, such as a remote URL", () => {
    expect(() => qrCodeDataUri("https://example.test/qr.png")).toThrow()
    expect(() => qrCodeDataUri("javascript:alert(1)")).toThrow()
  })
})

describe("TOTP code contract", () => {
  it("accepts six digits, dropping spaces a person typed", () => {
    expect(totpCodeSchema.parse("123 456")).toBe("123456")
    expect(mfaVerifySchema.parse({ code: " 654321 " })).toEqual({
      code: "654321",
    })
  })

  it.each(["12345", "1234567", "abcdef", ""])("refuses %j", (code) => {
    expect(totpCodeSchema.safeParse(code).success).toBe(false)
  })
})

describe("signInCompletionSchema", () => {
  it("round-trips what a sign-in ticket stores", () => {
    const completion = {
      identity: {
        provider: "supabase",
        subject: "subject-1",
        email: "owner@example.test",
        displayName: "Owner",
        emailVerified: true,
      },
      inviteTokenHash: null,
      passwordReset: true,
      authMethod: "password_reset",
    }
    expect(
      signInCompletionSchema.parse(JSON.parse(JSON.stringify(completion)))
    ).toEqual(completion)
  })
})
