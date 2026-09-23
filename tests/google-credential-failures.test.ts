import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn(), getDatabase: vi.fn() }))

const { credentialFailureCode } = await import("@/lib/server/google/transport")
const { accessTokenOwner, forgetAccessToken, rememberAccessToken } = await import(
  "@/lib/server/google/credentials"
)
const { grantsBusinessManage } = await import("@/lib/server/google/oauth")

describe("credentialFailureCode", () => {
  it("treats every 401 as a rejected credential", () => {
    expect(
      credentialFailureCode(401, { error: { status: "UNAUTHENTICATED" } })
    ).toBe("google_unauthenticated")
    expect(credentialFailureCode(401, null)).toBe("google_unauthenticated")
  })

  it("treats a 403 about the token's scopes as needing a fresh consent", () => {
    expect(
      credentialFailureCode(403, {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Request had insufficient authentication scopes.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            },
          ],
        },
      })
    ).toBe("insufficient_scope")
  })

  it("leaves a 403 about one account or location alone", () => {
    // Reconnecting cannot restore manager access that was removed at Google.
    expect(
      credentialFailureCode(403, {
        error: {
          status: "PERMISSION_DENIED",
          message: "The caller does not have permission",
        },
      })
    ).toBeNull()
    expect(credentialFailureCode(404, null)).toBeNull()
  })
})

describe("access token owners", () => {
  it("remembers and forgets which connection issued a token", () => {
    rememberAccessToken("token-a", { organisationId: "org", connectionId: "conn" })
    expect(accessTokenOwner("token-a")).toEqual({
      organisationId: "org",
      connectionId: "conn",
    })
    forgetAccessToken("token-a")
    expect(accessTokenOwner("token-a")).toBeNull()
    expect(accessTokenOwner("never-issued")).toBeNull()
  })
})

describe("grantsBusinessManage", () => {
  it("requires the full business.manage scope", () => {
    expect(
      grantsBusinessManage(
        "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/business.manage"
      )
    ).toBe(true)
    expect(
      grantsBusinessManage("openid https://www.googleapis.com/auth/userinfo.email")
    ).toBe(false)
    expect(grantsBusinessManage(undefined)).toBe(false)
  })
})
