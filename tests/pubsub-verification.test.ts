import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { verifyPubSubRequest } from "@/lib/server/pubsub"

import { jwtVerify } from "jose"

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: vi.fn(),
}))

const TOKEN = "harness-pubsub-token-32-characters!!"
const AUDIENCE = "https://reviews.example.com/api/webhooks/google/pubsub"
const PUSHER = "pubsub-push@naba.iam.gserviceaccount.com"

function env(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: undefined,
    GOOGLE_PUBSUB_AUDIENCE: undefined,
    GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: undefined,
    ...overrides,
  } as ServerEnv
}

function request(
  headers: Record<string, string> = {},
  path = "/api/webhooks/google/pubsub"
) {
  return new Request(`https://reviews.example.com${path}`, {
    method: "POST",
    headers,
  })
}

/** Resolves to the ApiError the verifier threw, or fails the test. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error("verifyPubSubRequest resolved but was expected to throw")
}

function identity(claims: Record<string, unknown>) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: claims } as never)
}

beforeEach(() => {
  vi.mocked(jwtVerify).mockReset()
})

describe("verifyPubSubRequest", () => {
  it("fails closed when neither verification mechanism is configured", async () => {
    const error = await rejection(verifyPubSubRequest(request(), env()))
    expect(error.status).toBe(503)
    expect(error.code).toBe("pubsub_not_configured")
  })

  describe("shared token", () => {
    const configured = env({ GOOGLE_PUBSUB_VERIFICATION_TOKEN: TOKEN })

    it("accepts the token from the header or the query string", async () => {
      await expect(
        verifyPubSubRequest(
          request({ "x-goog-pubsub-token": TOKEN }),
          configured
        )
      ).resolves.toBeUndefined()
      await expect(
        verifyPubSubRequest(
          request({}, `/api/webhooks/google/pubsub?token=${TOKEN}`),
          configured
        )
      ).resolves.toBeUndefined()
    })

    it("rejects an absent token", async () => {
      const error = await rejection(verifyPubSubRequest(request(), configured))
      expect(error.status).toBe(401)
      expect(error.code).toBe("invalid_pubsub_token")
    })

    it("rejects a wrong token of equal and of unequal length", async () => {
      const sameLength = `${"x".repeat(TOKEN.length - 1)}!`
      expect(sameLength).toHaveLength(TOKEN.length)
      for (const provided of [sameLength, "short"]) {
        const error = await rejection(
          verifyPubSubRequest(
            request({ "x-goog-pubsub-token": provided }),
            configured
          )
        )
        expect(error.status).toBe(401)
        expect(error.code).toBe("invalid_pubsub_token")
      }
    })
  })

  describe("OIDC identity", () => {
    const configured = env({
      GOOGLE_PUBSUB_AUDIENCE: AUDIENCE,
      GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: PUSHER,
    })
    const bearer = { authorization: "Bearer id-token" }

    it("fails closed when the audience is set without the service-account pin", async () => {
      // A token any GCP project can mint for this audience. Before the pin was
      // required this configuration verified it and let the request through.
      identity({
        email: "attacker@evil.iam.gserviceaccount.com",
        email_verified: true,
      })
      const error = await rejection(
        verifyPubSubRequest(
          request(bearer),
          env({ GOOGLE_PUBSUB_AUDIENCE: AUDIENCE })
        )
      )
      expect(error.status).toBe(503)
      expect(error.code).toBe("pubsub_not_configured")
      expect(jwtVerify).not.toHaveBeenCalled()
    })

    it("rejects a request with no bearer token", async () => {
      const error = await rejection(verifyPubSubRequest(request(), configured))
      expect(error.status).toBe(401)
      expect(error.code).toBe("pubsub_identity_required")
    })

    it("accepts the pinned, verified service account", async () => {
      identity({ email: PUSHER, email_verified: true })
      await expect(
        verifyPubSubRequest(request(bearer), configured)
      ).resolves.toBeUndefined()
      expect(jwtVerify).toHaveBeenCalledWith("id-token", "jwks", {
        audience: AUDIENCE,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      })
    })

    // The audience is not a secret: anyone with a GCP project can mint a token
    // for it against their own service account. The email claim is what makes
    // this an identity check.
    it("rejects a valid Google token minted by another service account", async () => {
      identity({
        email: "attacker@evil.iam.gserviceaccount.com",
        email_verified: true,
      })
      const error = await rejection(
        verifyPubSubRequest(request(bearer), configured)
      )
      expect(error.status).toBe(401)
      expect(error.code).toBe("invalid_pubsub_identity")
    })

    it("rejects a token with no email claim or an unverified one", async () => {
      for (const claims of [{}, { email: PUSHER, email_verified: false }]) {
        identity(claims)
        const error = await rejection(
          verifyPubSubRequest(request(bearer), configured)
        )
        expect(error.status).toBe(401)
        expect(error.code).toBe("invalid_pubsub_identity")
      }
    })

    it("propagates a signature, audience or issuer failure", async () => {
      vi.mocked(jwtVerify).mockRejectedValue(
        new Error('unexpected "aud" claim value')
      )
      await expect(
        verifyPubSubRequest(request(bearer), configured)
      ).rejects.toThrow('unexpected "aud" claim value')
    })
  })

  it("requires both mechanisms when both are configured", async () => {
    const configured = env({
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: TOKEN,
      GOOGLE_PUBSUB_AUDIENCE: AUDIENCE,
      GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: PUSHER,
    })
    identity({ email: PUSHER, email_verified: true })
    const missingIdentity = await rejection(
      verifyPubSubRequest(request({ "x-goog-pubsub-token": TOKEN }), configured)
    )
    expect(missingIdentity.code).toBe("pubsub_identity_required")
    const missingToken = await rejection(
      verifyPubSubRequest(
        request({ authorization: "Bearer id-token" }),
        configured
      )
    )
    expect(missingToken.code).toBe("invalid_pubsub_token")
  })
})
