import "server-only"

import { timingSafeEqual } from "node:crypto"

import { createRemoteJWKSet, jwtVerify } from "jose"

import type { ServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
)

function sameSecret(provided: string | null, expected: string) {
  if (!provided) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function verifyPubSubRequest(request: Request, env: ServerEnv) {
  if (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    const url = new URL(request.url)
    const provided =
      request.headers.get("x-goog-pubsub-token") ??
      url.searchParams.get("token")
    if (!sameSecret(provided, env.GOOGLE_PUBSUB_VERIFICATION_TOKEN)) {
      throw new ApiError(
        401,
        "invalid_pubsub_token",
        "Pub/Sub push token is invalid."
      )
    }
  }
  if (env.GOOGLE_PUBSUB_AUDIENCE) {
    // The audience is a caller-chosen claim in a Google-issued ID token, not
    // a secret: anyone with a GCP project can mint one for it. Only the
    // service-account pin makes this an identity check, so a deployment that
    // configures the audience without the pin is refused rather than served.
    if (!env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL) {
      throw new ApiError(
        503,
        "pubsub_not_configured",
        "Pub/Sub push verification is incomplete: set GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL to the push subscription's service account."
      )
    }
    const authorization = request.headers.get("authorization")
    const bearer = authorization?.match(/^Bearer ([^\s]+)$/)?.[1]
    if (!bearer) {
      throw new ApiError(
        401,
        "pubsub_identity_required",
        "Pub/Sub identity token is required."
      )
    }
    const { payload } = await jwtVerify(bearer, googleKeys, {
      audience: env.GOOGLE_PUBSUB_AUDIENCE,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    })
    if (
      payload.email !== env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL ||
      payload.email_verified !== true
    ) {
      throw new ApiError(
        401,
        "invalid_pubsub_identity",
        "Pub/Sub service account identity is invalid."
      )
    }
  }
  if (!env.GOOGLE_PUBSUB_VERIFICATION_TOKEN && !env.GOOGLE_PUBSUB_AUDIENCE) {
    throw new ApiError(
      503,
      "pubsub_not_configured",
      "Pub/Sub push verification is not configured."
    )
  }
}
