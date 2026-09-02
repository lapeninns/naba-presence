import { cookies } from "next/headers"

import {
  connectStartBodySchema,
  type ConnectStartResponse,
} from "@/lib/contracts/connections"
import { randomToken, signValue } from "@/lib/server/crypto"
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthUrl,
  pkceChallenge,
} from "@/lib/server/google"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  roles: ["owner", "admin"],
  body: connectStartBodySchema,
  handler: async ({ session }) => {
    const nonce = randomToken(24)
    const verifier = randomToken(64)
    const statePayload = Buffer.from(
      JSON.stringify({
        nonce,
        verifier,
        organisationId: session.organisationId,
        userId: session.userId,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
    ).toString("base64url")
    const signedState = `${statePayload}.${signValue(statePayload)}`
    ;(await cookies()).set("naba_google_oauth", signedState, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GOOGLE_OAUTH_CALLBACK_PATH,
      maxAge: 10 * 60,
    })
    return {
      authorizationUrl: googleOAuthUrl({
        state: nonce,
        codeChallenge: pkceChallenge(verifier),
      }),
    } satisfies ConnectStartResponse
  },
})
