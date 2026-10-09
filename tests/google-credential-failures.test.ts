import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn(), getDatabase: vi.fn() }))

const {
  credentialFailureCode,
  listingAccessFailureCode,
  locationNameFromUrl,
  operatorFailureCode,
} = await import("@/lib/server/google/transport")
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
  it("remembers and forgets which credential issued a token", () => {
    rememberAccessToken("token-a", {
      organisationId: "org",
      connectionId: "conn",
      generation: 3,
    })
    expect(accessTokenOwner("token-a")).toEqual({
      organisationId: "org",
      connectionId: "conn",
      generation: 3,
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

const REVIEWS =
  "https://mybusiness.googleapis.com/v4/accounts/1/locations/42/reviews"
const PERMISSION_DENIED = {
  error: {
    status: "PERMISSION_DENIED",
    message: "The caller does not have permission",
  },
}

describe("failure classification", () => {
  it("reads the location a Business Profile URL addresses", () => {
    expect(locationNameFromUrl(REVIEWS)).toEqual({
      locationName: "locations/42",
      locationScoped: true,
    })
    expect(
      locationNameFromUrl(
        "https://mybusinessbusinessinformation.googleapis.com/v1/locations/42?readMask=name"
      )
    ).toEqual({ locationName: "locations/42", locationScoped: true })
    expect(locationNameFromUrl(`${REVIEWS}/abc/reply`)).toEqual({
      locationName: "locations/42",
      locationScoped: false,
    })
    expect(
      locationNameFromUrl("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")
    ).toBeNull()
  })

  it("marks one listing, not the login, when Google denies that location", () => {
    expect(listingAccessFailureCode(403, PERMISSION_DENIED, REVIEWS)).toBe(
      "listing_permission_denied"
    )
    expect(listingAccessFailureCode(404, null, REVIEWS)).toBe("listing_not_found")
    // The login's credential is untouched by either.
    expect(credentialFailureCode(403, PERMISSION_DENIED)).toBeNull()
  })

  it("ignores a missing sub-resource and anything outside a location", () => {
    expect(listingAccessFailureCode(404, null, `${REVIEWS}/abc/reply`)).toBeNull()
    expect(
      listingAccessFailureCode(
        403,
        PERMISSION_DENIED,
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
      )
    ).toBeNull()
    expect(listingAccessFailureCode(500, null, REVIEWS)).toBeNull()
    expect(listingAccessFailureCode(429, null, REVIEWS)).toBeNull()
  })

  it("treats a disabled API as the operator's problem, not a listing's", () => {
    const disabled = {
      error: {
        status: "PERMISSION_DENIED",
        details: [{ reason: "SERVICE_DISABLED" }],
      },
    }
    expect(operatorFailureCode(403, disabled)).toBe(
      "google_operator_service_disabled"
    )
    expect(listingAccessFailureCode(403, disabled, REVIEWS)).toBeNull()
    expect(credentialFailureCode(403, disabled)).toBeNull()
  })

  it("leaves a scope 403 to the credential path", () => {
    const scope = {
      error: {
        status: "PERMISSION_DENIED",
        details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    }
    expect(listingAccessFailureCode(403, scope, REVIEWS)).toBeNull()
    expect(credentialFailureCode(403, scope)).toBe("insufficient_scope")
  })
})
